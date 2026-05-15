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
      console.log('[CallEngine] Using Twilio for outbound call (Triggered from VoiceLink branch)...');
      
      const twilio = require('twilio');
      const client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      const call = await client.calls.create({
        to: `+91${customer.phone.replace(/\D/g, '').slice(-10)}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        url: `${process.env.WEBHOOK_BASE_URL}/twilio/voice?customer_id=${customer.id}`,
        statusCallback: `${process.env.WEBHOOK_BASE_URL}/twilio/status`,
        statusCallbackMethod: 'POST',
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        record: true,
        recordingStatusCallback: `${process.env.WEBHOOK_BASE_URL}/twilio/recording`,
        recordingStatusCallbackMethod: 'POST'
      });

      try {
        const { data: insertedLog, error: insertError } = await supabaseAdmin.from('call_logs').insert({
          business_id: businessId,
          customer_id: customerId,
          twilio_call_sid: callId,
          status: 'initiated',
          outcome: 'no_answer',
          duration: 0,
          called_at: new Date().toISOString(),
          ai_summary: 'Call initiated'
        }).select();
        
        console.log('[Call Log Insert]', insertError ? `Error: ${insertError.message}` : 'Success', 'SID:', callId);
        if (insertedLog) console.log('[Call Log Created]', insertedLog[0].id);
      } catch (err) {
        console.error('[Call Log Error]', err.message);
      }

      return { callId, sessionId, status: 'initiated', provider: 'twilio-ws' };

      // Update customer call counts immediately
      await supabaseAdmin.from('customers').update({
        call_count_today: (customer.call_count_today || 0) + 1,
        total_calls: (customer.total_calls || 0) + 1,
        last_call_date: new Date().toISOString()
      }).eq('id', customerId);

      return { callId, sessionId, status: 'initiated', provider: 'twilio-ws' };
    }

    // Fallback to Twilio
    console.log('[CallEngine] Using Twilio for call...');
    const call = await makeCall({
      to: formatPhoneE164(customer.phone),
      from: business.twilio_phone_number || process.env.TWILIO_PHONE_NUMBER,
      webhookUrl: `${webhookBase}/webhook/twilio/voice?sessionId=${sessionId}`,
      statusCallback: `${webhookBase}/webhook/twilio/status?sessionId=${sessionId}`,
      accountSid: business.twilio_account_sid,
      authToken: business.twilio_auth_token,
      record: true
    });

    // Update session with Twilio SID
    activeCalls.get(sessionId).twilioCallSid = call.sid;

    // Create initial call log entry
    try {
      const { data: insertedLog, error: insertError } = await supabaseAdmin.from('call_logs').insert({
        business_id: businessId,
        customer_id: customerId,
        twilio_call_sid: call.sid,
        status: 'initiated',
        outcome: 'no_answer',
        duration: 0,
        called_at: new Date().toISOString(),
        ai_summary: 'Call initiated (Fallback)'
      }).select();
      
      console.log('[Call Log Insert (Fallback)]', insertError ? `Error: ${insertError.message}` : 'Success', 'SID:', call.sid);
      if (insertedLog) console.log('[Call Log Created (Fallback)]', insertedLog[0].id);
    } catch (err) {
      console.error('[Call Log Error (Fallback)]', err.message);
    }

    // Update customer call counts immediately
    await supabaseAdmin.from('customers').update({
      call_count_today: (customer.call_count_today || 0) + 1,
      total_calls: (customer.total_calls || 0) + 1,
      last_call_date: new Date().toISOString()
    }).eq('id', customerId);

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
async function postCallUpdate(sessionId, { status, duration, recordingUrl, explicitCallSid }) {
  const session = await getSession(sessionId);
  const callSid = explicitCallSid || session?.callSid;
  
  if (!callSid) {
    console.error(`[PostCall] No CallSid found for session ${sessionId}. Cannot update DB.`);
    return;
  }
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

/**
 * Get session with auto-recovery if missing from memory
 */
async function getSession(sessionId) {
  let session = activeCalls.get(sessionId);
  if (session) return session;

  console.log(`[CallEngine] Session ${sessionId} not in memory. Attempting recovery...`);
  
  try {
    // Session ID format: `${businessId}_${customerId}_${Date.now()}`
    const parts = sessionId.split('_');
    if (parts.length < 3) return null;

    const businessId = parts[0];
    const customerId = parts[1];

    // Fetch required data to rebuild session
    const { data: business } = await supabaseAdmin.from('businesses').select('*').eq('id', businessId).single();
    const { data: customer } = await supabaseAdmin.from('customers').select('*').eq('id', customerId).single();
    const { data: agent } = await supabaseAdmin.from('agents').select('*').eq('business_id', businessId).eq('is_active', true).single();

    // Fetch the latest call SID for this customer to link the session
    const { data: lastLog } = await supabaseAdmin
      .from('call_logs')
      .select('twilio_call_sid')
      .eq('customer_id', customerId)
      .order('called_at', { ascending: false })
      .limit(1)
      .single();

    if (!business || !customer || !agent) return null;

    const systemPrompt = generatePrompt(agent, customer, business);
    
    // Rebuild the session
    session = {
      businessId,
      customerId,
      business,
      agent,
      customer,
      callSid: lastLog?.twilio_call_sid, // Link the recovered SID
      systemPrompt,
      messages: [{ role: 'system', content: systemPrompt }],
      transcript: '[Recovered Session]\n',
      startTime: Date.now(),
      isRecovered: true
    };

    activeCalls.set(sessionId, session);
    console.log(`[CallEngine] Session recovered successfully for ${customer.customer_name} (SID: ${session.callSid})`);
    return session;
  } catch (err) {
    console.error('[CallEngine] Session recovery failed:', err.message);
    return null;
  }
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
