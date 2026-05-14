const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const { generatePrompt } = require('../utils/promptGenerator');
const { detectOutcome } = require('../utils/outcomeDetector');
const { createClient } = require('@deepgram/sdk');
const OpenAI = require('openai');
const { supabaseAdmin: supabase } = require('../services/supabase');
const { triggerVoiceLinkCall } = require('../services/voicelink');
const { generateTTS } = require('../services/tts');

// Initialize clients lazily to prevent crash if keys are missing
let deepgram = null;
let openai = null;

function initClients() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  
  if (!deepgram && process.env.DEEPGRAM_API_KEY) {
    deepgram = createClient(process.env.DEEPGRAM_API_KEY);
  }
}

// Store active sessions
const sessions = new Map();

// WebSocket handler for VoiceLink
function setupVoiceLinkWebSocket(wss) {
  wss.on('connection', async (ws, req) => {
    initClients();
    
    const sessionId = req.url.split('?')[0].split('/').pop() || Date.now().toString();
    console.log('[VoiceLink WS] Session Connected:', sessionId);

    if (!deepgram || !openai) {
      console.error('[VoiceLink WS] Missing core API keys. Closing.');
      ws.close();
      return;
    }

    const session = {
      id: sessionId,
      ws,
      transcript: [],
      messages: [],
      customerData: null,
      agentData: null,
      businessData: null,
      isGreetingSent: false,
      deepgramLive: null
    };
    sessions.set(sessionId, session);

    // Parse session ID or customer ID from URL if present
    const url = new URL(req.url, `http://${req.headers.host}`);
    const customerId = url.searchParams.get('customer_id') || sessionId;

    try {
      // Setup Deepgram live transcription (STT)
      const deepgramLive = deepgram.listen.live({
        model: 'nova-2',
        language: 'hi',
        encoding: 'mulaw',
        sample_rate: 8000,
        interim_results: false,
        punctuate: true
      });

      deepgramLive.on('open', () => {
        console.log('[VoiceLink] Deepgram connection opened');
      });

      deepgramLive.on('Results', async (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (!transcript || transcript.trim() === '') return;

        console.log(`[VoiceLink STT ${sessionId}]`, transcript);
        session.transcript.push({ role: 'customer', text: transcript });

        const aiResponse = await getAIResponse(session, transcript);
        if (aiResponse) {
          await sendAudio(session, aiResponse);
        }
      });

      deepgramLive.on('error', (err) => console.error('[VoiceLink] Deepgram Error:', err));
      session.deepgramLive = deepgramLive;
    } catch (err) {
      console.error('[VoiceLink] Deepgram Setup Error:', err);
    }

    // Handle incoming messages
    ws.on('message', async (data) => {
      // console.log(`[VoiceLink WS Message ${sessionId}] Size: ${data.length} bytes`);
      
      try {
        const message = JSON.parse(data.toString());
        console.log(`[VoiceLink JSON ${sessionId}]`, message);
        
        if (message.event === 'start' || message.type === 'start') {
          await loadSessionData(session, message, customerId);
          if (!session.isGreetingSent) {
            const greeting = await generateGreeting(session);
            await sendAudio(session, greeting);
            session.isGreetingSent = true;
          }
        } else if (message.event === 'stop' || message.type === 'stop') {
          await handleCallEnd(session);
        }
      } catch {
        // Assume binary audio
        if (!session.isGreetingSent) {
          // Send greeting on first audio chunk if not already sent
          await loadSessionData(session, {}, customerId);
          const greeting = await generateGreeting(session);
          await sendAudio(session, greeting);
          session.isGreetingSent = true;
        }

        if (session.deepgramLive && session.deepgramLive.getReadyState() === 1) {
          session.deepgramLive.send(data);
        }
      }
    });

    ws.on('close', async () => {
      console.log('[VoiceLink WS] Session Disconnected:', sessionId);
      if (session.deepgramLive) session.deepgramLive.finish();
      await handleCallEnd(session);
      sessions.delete(sessionId);
    });
  });
}

async function sendAudio(session, text) {
  try {
    const gender = session.agentData?.gender === 'male' ? 'male' : 'female';
    const audioBuffer = await generateTTS(text, gender);
    if (audioBuffer && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        event: 'audio',
        data: audioBuffer.toString('base64'),
        encoding: 'mp3'
      }));
      console.log(`[VoiceLink Audio Sent] Text: ${text.substring(0, 30)}...`);
    }
  } catch (err) {
    console.error('[VoiceLink Send Audio Error]', err);
  }
}

async function loadSessionData(session, message, customerId) {
  if (session.customerData) return; // Already loaded

  try {
    // 1. Try loading by customerId (UUID)
    if (customerId && customerId.length > 20) {
      const { data: customer } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single();
      session.customerData = customer;
    }

    // 2. Fallback to phone number from message
    if (!session.customerData) {
      const phone = message.from || message.caller_id || message.customer_number;
      if (phone) {
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const { data: customer } = await supabase
          .from('customers')
          .select('*')
          .ilike('phone', `%${cleanPhone}%`)
          .single();
        session.customerData = customer;
      }
    }

    const { data: agent } = await supabase.from('agent_config').select('*').eq('is_active', true).limit(1).single();
    const { data: business } = await supabase.from('business_profile').select('*').limit(1).single();
    
    session.agentData = agent;
    session.businessData = business;

    if (session.customerData && session.agentData && session.businessData) {
      const systemPrompt = generatePrompt(session.agentData, session.customerData, session.businessData);
      session.messages = [{ role: 'system', content: systemPrompt }];
    }
  } catch (err) {
    console.error('[VoiceLink Data Load Error]', err.message);
  }
}

async function generateGreeting(session) {
  if (!session.agentData || !session.customerData) {
    return 'Namaste! Main aapka AI assistant bol raha hoon. Kya aap meri aawaj sun sakte hain?';
  }
  const { agent_name, gender } = session.agentData;
  const isMale = gender === 'male';
  return `Namaste! Main ${agent_name} bol ra${isMale ? 'ha' : 'hi'} hoon, ${session.businessData?.business_name || 'CollectAI'} se. Kya main ${session.customerData?.customer_name} ji se baat kar sakta hoon?`;
}

async function getAIResponse(session, userText) {
  try {
    if (!session.messages.length) return null;
    session.messages.push({ role: 'user', content: userText });
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: session.messages,
      max_tokens: 150,
      temperature: 0.7
    });

    const aiText = response.choices[0].message.content;
    session.messages.push({ role: 'assistant', content: aiText });
    session.transcript.push({ role: 'agent', text: aiText });
    return aiText;
  } catch (err) {
    console.error('[VoiceLink AI Error]', err.message);
    return 'Maaf kijiye, main samajh nahi paya.';
  }
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
        promise_date: outcome.promise_date,
        status: 'completed',
        called_at: new Date().toISOString()
      });
      await supabase.from('customers').update({ status: outcome.outcome, last_call_date: new Date() }).eq('id', session.customerData.id);
    }
  } catch (err) {
    console.error('[Call End Error]', err);
  }
}

router.post('/webhook', async (req, res) => {
  console.log('[VoiceLink Webhook]', JSON.stringify(req.body, null, 2));
  res.json({ status: 'ok' });
});

router.post('/call', async (req, res) => {
  try {
    const { customerId } = req.body;
    const { data: customer } = await supabase.from('customers').select('*').eq('id', customerId).single();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const data = await triggerVoiceLinkCall(customer, {});
    res.json({ success: true, call: data });
  } catch (err) {
    console.error('[VoiceLink Call Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setupVoiceLinkWebSocket };
