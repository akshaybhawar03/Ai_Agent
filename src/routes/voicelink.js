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

// Initialize clients lazily
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

const sessions = new Map();

function setupVoiceLinkWebSocket(wss) {
  wss.on('connection', async (ws, req) => {
    initClients();
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const customerId = url.searchParams.get('customer_id');
    const sessionId = customerId || Date.now().toString();
    
    console.log('[VoiceLink WS] Connected Session:', sessionId);

    const session = {
      id: sessionId,
      ws,
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
        encoding: 'mulaw',
        sample_rate: 8000,
        interim_results: false,
        punctuate: true
      });

      deepgramLive.on('open', () => console.log('[VoiceLink] Deepgram STT Ready'));
      deepgramLive.on('Results', async (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (!transcript || transcript.trim() === '') return;

        console.log(`[VoiceLink STT ${sessionId}]`, transcript);
        session.transcript.push({ role: 'customer', text: transcript });

        const aiResponse = await getAIResponse(session, transcript);
        if (aiResponse) await sendAudio(session, aiResponse);
      });

      session.deepgramLive = deepgramLive;
    } catch (err) {
      console.error('[VoiceLink] Deepgram Init Error:', err);
    }

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Capture streamSid from any message that has it
        if (message.streamSid && !session.streamSid) {
          session.streamSid = message.streamSid;
          console.log(`[VoiceLink SID ${sessionId}] Captured Stream SID: ${session.streamSid}`);
        }

        if (message.event === 'start') {
          console.log(`[VoiceLink START ${sessionId}]`, message.start);
          await loadSessionData(session, message.start, customerId);
          if (!session.isGreetingSent) {
            const greeting = await generateGreeting(session);
            await sendAudio(session, greeting);
            session.isGreetingSent = true;
          }
        } else if (message.event === 'media') {
          // If we haven't sent greeting but are receiving media, trigger it now
          if (!session.isGreetingSent && session.streamSid) {
            await loadSessionData(session, {}, customerId);
            const greeting = await generateGreeting(session);
            await sendAudio(session, greeting);
            session.isGreetingSent = true;
          }

          if (session.deepgramLive && session.deepgramLive.getReadyState() === 1) {
            session.deepgramLive.send(Buffer.from(message.media.payload, 'base64'));
          }
        } else if (message.event === 'stop') {
          await handleCallEnd(session);
        }
      } catch (e) {
        // Ignore binary or malformed JSON
      }
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
    if (!session.streamSid) {
      console.warn('[VoiceLink] Cannot send audio, missing streamSid');
      return;
    }

    const gender = session.agentData?.gender === 'male' ? 'male' : 'female';
    const audioBuffer = await generateTTS(text, gender);
    
    if (audioBuffer && session.ws.readyState === WebSocket.OPEN) {
      // VoiceLink (Twilio Style) expects media event with base64 payload
      const message = {
        event: 'media',
        streamSid: session.streamSid,
        media: {
          payload: audioBuffer.toString('base64')
        }
      };
      session.ws.send(JSON.stringify(message));
      console.log(`[VoiceLink Sent ${session.id}] Text: ${text.substring(0, 30)}...`);
    }
  } catch (err) {
    console.error('[VoiceLink Audio Send Error]', err);
  }
}

async function loadSessionData(session, startData, customerId) {
  if (session.customerData) return;
  try {
    const id = customerId || (startData.customParameters && startData.customParameters.customer_id);
    if (id) {
      const { data } = await supabase.from('customers').select('*').eq('id', id).single();
      session.customerData = data;
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
    console.error('[VoiceLink Load Data Error]', err.message);
  }
}

async function generateGreeting(session) {
  if (!session.agentData || !session.customerData) {
    return 'Namaste! Main aapka AI assistant bol raha hoon. Kya aap meri aawaj sun sakte hain?';
  }
  const { agent_name, gender } = session.agentData;
  return `Namaste! Main ${agent_name} bol ra${gender === 'male' ? 'ha' : 'hi'} hoon, ${session.businessData?.business_name || 'CollectAI'} se. Kya main ${session.customerData?.customer_name} ji se baat kar sakta hoon?`;
}

async function getAIResponse(session, userText) {
  try {
    if (!session.messages.length) return null;
    session.messages.push({ role: 'user', content: userText });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: session.messages,
      max_tokens: 150
    });
    const aiText = completion.choices[0].message.content;
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
        status: 'completed',
        called_at: new Date().toISOString()
      });
      await supabase.from('customers').update({ status: outcome.outcome, last_call_date: new Date() }).eq('id', session.customerData.id);
    }
  } catch (err) {
    console.error('[Call End Error]', err);
  }
}

router.post('/webhook', (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setupVoiceLinkWebSocket };
