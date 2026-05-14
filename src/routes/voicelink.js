const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const { generatePrompt } = require('../utils/promptGenerator');
const { detectOutcome } = require('../utils/outcomeDetector');
const { createClient } = require('@deepgram/sdk');
const { supabaseAdmin: supabase } = require('../services/supabase');
const { triggerVoiceLinkCall } = require('../services/voicelink');
const { generateTTS } = require('../services/tts');

// Initialize clients
let deepgram = null;
function initClients() {

  if (!deepgram && process.env.DEEPGRAM_API_KEY) {
    deepgram = createClient(process.env.DEEPGRAM_API_KEY);
  }
}

const sessions = new Map();

function setupVoiceLinkWebSocket(wss) {
  wss.on('connection', async (ws, req) => {
    initClients();
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const customerId = url.searchParams.get('customer_id');
    const sessionId = customerId || Date.now().toString();
    
    console.log('[VoiceLink WS] Session Connected:', sessionId);

    const session = {
      id: sessionId,
      ws,
      wsUrl: req.url, // Bug 3 Fix: Store URL for parameter extraction
      streamSid: null,
      transcript: [],
      messages: [],
      customerData: null,
      agentData: null,
      businessData: null,
      isGreetingSent: false,
      deepgramLive: null
    };
    sessions.set(sessionId, session);

    try {
      const deepgramLive = deepgram.listen.live({
        model: 'nova-2',
        language: 'hi',
        encoding: 'alaw',        // VoiceLink uses ALAW
        sample_rate: 8000,
        interim_results: false,
        punctuate: true
      });

      deepgramLive.on('open', () => console.log('[VoiceLink] Deepgram STT Ready'));
      
      deepgramLive.addListener('Results', async (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (!transcript?.trim()) return;
        
        console.log('[VoiceLink STT]', session.id, transcript);
        session.transcript.push({ role: 'customer', text: transcript });

        try {
          // Special Handling for "Yes/Haan" - Bypass AI for speed and accuracy
          const lowerTranscript = transcript.toLowerCase().trim();
          const isSimpleYes = ['haan', 'ha', 'haa', 'yes', 'ji', 'ji haan', 'theek hai', 'okay', 'ok'].includes(lowerTranscript);

          if (isSimpleYes && session.messages.length <= 8) {
            const directResponse = `Bilkul ji! Toh kaunsi date pakki karein? Kal ya parson?`;
            session.messages.push({ role: 'user', content: transcript });
            session.messages.push({ role: 'assistant', content: directResponse });
            session.transcript.push({ role: 'agent', text: directResponse });
            await sendAudio(session, directResponse);
            return;
          }

          // Ensure session data is loaded
          if (!session.messages.length) {
            await loadSessionData(session, {}, customerId);
          }
          
          const aiText = await getAIResponse(session, transcript);
          if (aiText) {
            await sendAudio(session, aiText);
          }
        } catch (err) {
          console.error('[VoiceLink AI Error]', err.message);
        }
      });

      session.deepgramLive = deepgramLive;
    } catch (err) {
      console.error('[VoiceLink] Deepgram Init Error:', err);
    }

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Bug 1 & 2 Fix: Stream SID and Customer ID Capture
        const currentSid = message.streamSid || message.stream_sid || (message.start && message.start.stream_sid);
        
        if (currentSid && !session.streamSid) {
          session.streamSid = currentSid;
          console.log(`[VoiceLink SID ${sessionId}] Captured: ${session.streamSid}`);
          
          // Bug 2 Fix: Get customer_id from custom_parameters or URL
          const customParams = (message.start && message.start.custom_parameters) || {};
          const extractedCustomerId = customParams.customer_id || 
                             new URLSearchParams((session.wsUrl || '').split('?')[1]).get('customer_id');
          
          console.log('[VoiceLink] Extracted Customer ID:', extractedCustomerId);

          // ONLY trigger greeting once session context is fully established
          if (!session.isGreetingSent) {
            session.isGreetingSent = true;
            await loadSessionData(session, message.start || {}, extractedCustomerId);
            const greeting = await generateGreeting(session);
            await sendAudio(session, greeting);
          }
        }

        if (message.event === 'media' && session.streamSid) {
          if (session.deepgramLive && session.deepgramLive.getReadyState() === 1) {
            session.deepgramLive.send(Buffer.from(message.media.payload, 'base64'));
          }
        } else if (message.event === 'stop') {
          await handleCallEnd(session);
        }
      } catch (e) {}
    });

    ws.on('close', async () => {
      console.log('[VoiceLink WS] Session Closed:', sessionId);
      if (session.deepgramLive) session.deepgramLive.finish();
      await handleCallEnd(session);
      sessions.delete(sessionId);
    });
  });
}

async function sendAudio(session, text) {
  try {
    const audioBuffer = await generateTTS(text);
    if (!audioBuffer || session.ws.readyState !== WebSocket.OPEN) return;
    
    // Official VoiceLink Media Event Format
    const payload = {
      event: 'media',
      media: {
        payload: audioBuffer.toString('base64')
      }
    };
    
    session.ws.send(JSON.stringify(payload));
    console.log('[VoiceLink Sent] ALAW audio event, size:', audioBuffer.length);
    
  } catch (err) {
    console.error('[VoiceLink Send Audio Error]', err.message);
  }
}

async function loadSessionData(session, startData, customerId) {
  if (session.customerData) return;
  try {
    const id = customerId || (startData && startData.customParameters && startData.customParameters.customer_id);
    if (id) {
      const { data } = await supabase.from('customers').select('*').eq('id', id).single();
      session.customerData = data;
    }
    const { data: agent } = await supabase.from('agent_config').select('*').eq('is_active', true).limit(1).single();
    const { data: business } = await supabase.from('business_profile').select('*').limit(1).single();
    
    session.agentData = agent;
    session.businessData = business;

    // Set the system prompt - Use dynamic data if available, otherwise strict fallback
    const systemPrompt = (session.customerData && session.agentData && session.businessData)
      ? generatePrompt(session.agentData, session.customerData, session.businessData)
      : `Tu ek professional Hindi collection agent hai. 
         Sirf Hindi/Hinglish mein baat kar. 
         Agar customer "Hello" bole toh pooch: 
         "Namaste! Kya main aapse payment ke baare mein baat kar sakta hoon?"
         Short and polite raho. Max 2 sentences per response.`;

    const combinedPrompt = `${systemPrompt}\n\nENFORCEMENT RULES - IN PRIORITY ORDER:\n1. NEVER ask how customer wants to pay - that is NOT your job\n2. NEVER explain payment methods (online/office/UPI etc)\n3. NEVER ask for account details or order details - you already know them\n4. Your ONLY job: Get a payment DATE from customer\n5. Keep response under 20 words always\n6. If customer says haan/yes - immediately ask for a specific date\n7. If you have a date - say "Dhanyawad, namaskar!" and STOP completely\n8. Speak only Hinglish - NO full English sentences ever`;

    session.messages = [{ role: 'system', content: combinedPrompt }];
    console.log(`[VoiceLink] System prompt set for customer: ${session.customerData?.customer_name || 'Unknown'}`);
    
  } catch (err) {
    console.error('[VoiceLink Load Data Error]', err.message);
    session.messages = [{ 
      role: 'system', 
      content: 'Tu ek professional Hindi collection agent hai. Sirf Hindi mein baat kar. ONLY MISSION: Get a payment date. Keep it short.' 
    }];
  }
}

async function generateGreeting(session) {
  if (!session.agentData || !session.customerData) return 'Namaste! Main aapka AI assistant bol raha hoon.';
  return `Namaste! Main ${session.agentData.agent_name} bol ra${session.agentData.gender === 'male' ? 'ha' : 'hi'} hoon, ${session.businessData?.business_name || 'CollectAI'} se. Kya main ${session.customerData?.customer_name} ji se baat kar sakta hoon?`;
}

async function handleCallEnd(session) {
  if (session.transcript.length === 0) return;
  const fullTranscript = session.transcript.map(t => `${t.role}: ${t.text}`).join('\n');
  try {
    const outcome = await detectOutcome(fullTranscript);
    if (session.customerData?.id) {
      await supabase.from('call_logs').insert({
        business_id: session.businessData?.id,
        customer_id: session.customerData.id,
        transcript: fullTranscript,
        ai_summary: outcome.summary,
        outcome: outcome.outcome,
        status: 'completed',
        called_at: new Date().toISOString()
      });
      await supabase.from('customers').update({ status: outcome.outcome, last_call_date: new Date() }).eq('id', session.customerData.id);
    }
  } catch (err) {}
}

router.post('/webhook', (req, res) => res.json({ status: 'ok' }));

router.post('/call', async (req, res) => {
  try {
    const { customerId } = req.body;
    const { data: customer } = await supabase.from('customers').select('*').eq('id', customerId).single();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const data = await triggerVoiceLinkCall(customer, {});
    res.json({ success: true, call: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getAIResponse(session, userText) {
  if (!session.messages || session.messages.length === 0) return null;

  session.messages.push({ role: 'user', content: userText });

  try {
    const response = await fetch('https://api.sarvam.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sarvam-m',
        messages: session.messages,
        max_tokens: 60,
        temperature: 0.1,
        top_p: 0.5
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[Sarvam LLM Error]', err);
      return null;
    }

    const data = await response.json();
    const aiText = data.choices[0].message.content;
    
    session.messages.push({ role: 'assistant', content: aiText });
    session.transcript.push({ role: 'agent', text: aiText });
    
    console.log('[Sarvam AI Response]', aiText);
    return aiText;
  } catch (err) {
    console.error('[Sarvam LLM Fetch Error]', err.message);
    return null;
  }
}

module.exports = { router, setupVoiceLinkWebSocket };
