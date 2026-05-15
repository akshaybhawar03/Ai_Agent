/**
 * Call Engine - Orchestrates the entire calling process
 * Handles: initiating calls, managing conversations, post-call updates
 */
const { supabaseAdmin } = require('../services/supabase');
const { makeCall } = require('../services/twilio');
const { triggerVoiceLinkCall } = require('./voicelink');
const { getOpenAIClient, getModelName } = require('../services/openai');
const { generatePrompt } = require('../utils/promptGenerator');
const { detectOutcome, mapOutcomeToStatus } = require('../utils/outcomeDetector');

// In-memory store for active call sessions
const activeCalls = new Map();

/**
 * Format phone number to E.164 format
 * Handles: 9022794398, 09022794398, 919022794398, +919022794398
 */
function formatPhoneE164(phone) {
  if (!phone) return phone;
  // Strip all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');
  // If already starts with +, return as-is
  if (cleaned.startsWith('+')) return cleaned;
  // Remove leading 0 (domestic format)
  if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
  // If 10 digits (Indian local), prepend +91
  if (cleaned.length === 10) return `+91${cleaned}`;
  // If 12 digits starting with 91, prepend +
  if (cleaned.length === 12 && cleaned.startsWith('91')) return `+${cleaned}`;
  // Fallback: prepend + and hope for the best
  return `+${cleaned}`;
}

/**
 * Initiate a single call to a customer
 */
async function initiateCall(customerId, businessId) {
  // Fetch business, agent, and customer data
  const { data: business } = await supabaseAdmin
    .from('businesses')
    .select('*')
    .eq('id', businessId)
    .single();

  if (!business) throw new Error('Business not found');

  const { data: agent } = await supabaseAdmin
    .from('agents')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .single();

  if (!agent) throw new Error('No active agent found');

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .single();

  if (!customer) throw new Error('Customer not found');

  // Daily call limit check disabled for testing
  /*
  if (customer.call_count_today >= (agent.calls_per_day || 3)) {
    throw new Error('Daily call limit reached for this customer');
  }
  */

  // Generate the system prompt
  const systemPrompt = generatePrompt(agent, customer, business);

  // Store call session
  const sessionId = `${businessId}_${customerId}_${Date.now()}`;
  activeCalls.set(sessionId, {
    businessId,
    customerId,
    business,
    agent,
    customer,
    systemPrompt,
    messages: [{ role: 'system', content: systemPrompt }],
    transcript: '',
    startTime: Date.now()
  });

  const webhookBase = process.env.WEBHOOK_BASE_URL;

  try {
    const isVoiceLinkEnabled = process.env.VOICELINK_DID_NUMBER && 
                              (process.env.VOICELINK_API_KEY || (process.env.VOICELINK_USERNAME && process.env.VOICELINK_PASSWORD));

    if (isVoiceLinkEnabled) {
      console.log('[CallEngine] Using VoiceLink for call...');
      const call = await triggerVoiceLinkCall(customer, business);
      
      await supabaseAdmin.from('call_logs').insert({
        business_id: businessId,
        customer_id: customerId,
        customer_name: customer.customer_name,
        customer_phone: customer.phone,
        twilio_call_sid: call.id || sessionId, // VoiceLink ID as SID
        status: 'initiated',
        outcome: 'in_progress',
        called_at: new Date().toISOString()
      });

      return { callId: call.id, sessionId, status: 'initiated', provider: 'voicelink' };
    }

    // Fallback to Twilio
    console.log('[CallEngine] Using Twilio for call...');
    const call = await makeCall({
      to: formatPhoneE164(customer.phone),
      from: business.twilio_phone_number || process.env.TWILIO_PHONE_NUMBER,
      webhookUrl: `${webhookBase}/webhook/twilio/voice?sessionId=${sessionId}`,
      statusCallback: `${webhookBase}/webhook/twilio/status?sessionId=${sessionId}`,
      accountSid: business.twilio_account_sid,
      authToken: business.twilio_auth_token
    });

    // Update session with Twilio SID
    activeCalls.get(sessionId).twilioCallSid = call.sid;

    // Create initial call log entry
    await supabaseAdmin.from('call_logs').insert({
      business_id: businessId,
      customer_id: customerId,
      customer_name: customer.customer_name,
      customer_phone: customer.phone,
      twilio_call_sid: call.sid,
      status: 'initiated',
      outcome: 'in_progress',
      called_at: new Date().toISOString()
    });

    return { callSid: call.sid, sessionId, status: 'initiated', provider: 'twilio' };
  } catch (error) {
    activeCalls.delete(sessionId);
    throw error;
  }
}

/**
 * Process AI response for a conversation turn
 */
async function processConversation(sessionId, userSpeech) {
  const session = activeCalls.get(sessionId);
  if (!session) throw new Error('Call session not found');

  // Add user message
  if (userSpeech) {
    session.messages.push({ role: 'user', content: userSpeech });
    session.transcript += `Customer: ${userSpeech}\n`;
  }

  const apiKey = session.business.groq_api_key || process.env.GROQ_API_KEY || session.business.openai_api_key || process.env.OPENAI_API_KEY;
  const client = getOpenAIClient(apiKey);

  // Get AI response
  const response = await client.chat.completions.create({
    model: process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : getModelName(),
    messages: session.messages,
    max_tokens: 100,
    temperature: 0.7
  });

  const aiMessage = response.choices[0].message.content;
  session.messages.push({ role: 'assistant', content: aiMessage });
  session.transcript += `Agent: ${aiMessage}\n`;

  // Check if call should end
  const shouldEnd = aiMessage.toLowerCase().includes('namaste') &&
    (aiMessage.toLowerCase().includes('dhanyawad') || session.messages.length > 10);

  // OpenAI TTS voices: alloy, echo, fable, onyx, nova, shimmer
  // Default to onyx (best for Hindi male)
  const voice = session.agent.gender === 'female' ? 'nova' : 'onyx';
    
  return {
    response: aiMessage,
    shouldEnd,
    voice
  };
}

/**
 * Handle post-call processing
 */
async function postCallUpdate(sessionId, data = {}) {
  const session = activeCalls.get(sessionId);
  if (!session) return;

  const { duration, recordingUrl } = data;
  const apiKey = session.business.openai_api_key || process.env.OPENAI_API_KEY;

  try {
    // Detect outcome from transcript
    const outcomeData = await detectOutcome(session.transcript, apiKey);

    // Update customer record
    const { data: currentCustomer } = await supabaseAdmin
      .from('customers')
      .select('call_count_today, total_calls')
      .eq('id', session.customerId)
      .single();

    await supabaseAdmin.from('customers').update({
      call_count_today: (currentCustomer?.call_count_today || 0) + 1,
      total_calls: (currentCustomer?.total_calls || 0) + 1,
      last_call_date: new Date().toISOString(),
      status: mapOutcomeToStatus(outcomeData.outcome),
      payment_promise_date: outcomeData.promise_date,
      call_notes: outcomeData.summary
    }).eq('id', session.customerId);

    // Update call log
    await supabaseAdmin.from('call_logs').update({
      duration: duration || Math.floor((Date.now() - session.startTime) / 1000),
      transcript: session.transcript,
      ai_summary: outcomeData.summary,
      recording_url: recordingUrl || null,
      outcome: outcomeData.outcome,
      amount_promised: outcomeData.amount_promised,
      promise_date: outcomeData.promise_date,
      status: 'completed'
    }).eq('twilio_call_sid', session.twilioCallSid);
  } catch (error) {
    console.error('Post-call update failed:', error.message);
    // Still update the log as completed even if analysis fails
    await supabaseAdmin.from('call_logs').update({
      duration: duration || Math.floor((Date.now() - session.startTime) / 1000),
      transcript: session.transcript,
      status: 'completed',
      outcome: 'error'
    }).eq('twilio_call_sid', session.twilioCallSid);
  } finally {
    // Clean up session
    activeCalls.delete(sessionId);
  }
}

/**
 * Bulk call all pending customers for a business
 */
async function bulkCall(businessId) {
  const { data: agent } = await supabaseAdmin
    .from('agents')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .single();

  if (!agent) throw new Error('No active agent configured');

  const { data: customers } = await supabaseAdmin
    .from('customers')
    .select('*')
    .eq('business_id', businessId)
    .in('status', ['pending', 'callback', 'promised'])
    .lt('call_count_today', agent.calls_per_day || 3)
    .order('days_pending', { ascending: false });

  if (!customers || customers.length === 0) {
    return { message: 'No pending customers to call', called: 0 };
  }

  const results = [];
  for (const customer of customers) {
    try {
      const result = await initiateCall(customer.id, businessId);
      console.log(`[CallEngine] Bulk Call initiated for ${customer.customer_name}`);
      results.push({ customerId: customer.id, ...result });
      
      // Wait 3 seconds between calls to avoid queue overflow
      await new Promise(r => setTimeout(r, 3000));
    } catch (error) {
      results.push({ customerId: customer.id, error: error.message });
    }
  }

  return { called: results.filter(r => !r.error).length, total: customers.length, results };
}

function getSession(sessionId) {
  return activeCalls.get(sessionId);
}

function getActiveCalls() {
  return activeCalls;
}

module.exports = {
  initiateCall,
  processConversation,
  postCallUpdate,
  bulkCall,
  getSession,
  getActiveCalls
};
