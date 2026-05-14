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

// Initialize clients
let deepgram = null;
let groq = null;
let openai = null;

function initClients() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  
  // Use Groq as primary for AI if available
  if (!groq && process.env.GROQ_API_KEY) {
    groq = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1'
    });
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
    
    console.log('[VoiceLink WS] Session Connected:', sessionId);

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
      
      deepgramLive.addListener('Results', async (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (!transcript?.trim()) return;
        
        console.log('[VoiceLink STT]', session.id, transcript);
        session.transcript.push({ role: 'customer', text: transcript });

        try {
          if (!session.messages.length) {
            await loadSessionData(session, {}, customerId);
          }
          
          session.messages.push({ role: 'user', content: transcript });
          
          // Use Groq primarily, fallback to OpenAI
          const aiClient = groq || openai;
          if (!aiClient) throw new Error('No AI client available');

          const response = await aiClient.chat.completions.create({
            model: groq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini',
            messages: session.messages,
            max_tokens: 100
          });

          const aiText = response.choices[0].message.content;
          session.messages.push({ role: 'assistant', content: aiText });
          session.transcript.push({ role: 'agent', text: aiText });
          
          console.log('[VoiceLink AI Response]', aiText);
          await sendAudio(session, aiText);
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
        const currentSid = message.streamSid || message.stream_sid || (message.start && message.start.stream_sid);
        if (currentSid && !session.streamSid) {
          session.streamSid = currentSid;
          console.log(`[VoiceLink SID ${sessionId}] Captured: ${session.streamSid}`);
        }

        if (message.event === 'start') {
          await loadSessionData(session, message.start, customerId);
          if (!session.isGreetingSent && session.streamSid) {
            const greeting = await generateGreeting(session);
            await sendAudio(session, greeting);
            session.isGreetingSent = true;
          }
        } else if (message.event === 'media') {
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
    if (!session.streamSid) return;
    console.log('[TTS] Generating audio for:', text.substring(0, 50));
    const audioBuffer = await generateTTS(text);
    console.log('[TTS] Audio result:', audioBuffer ? audioBuffer.length + ' bytes' : 'NULL');
    
    if (!audioBuffer || session.ws.readyState !== WebSocket.OPEN) return;
    
    session.ws.send(JSON.stringify({
      event: 'media',
      stream_sid: session.streamSid,
      media: { payload: audioBuffer.toString('base64') }
    }));
    console.log('[VoiceLink Sent]', session.id, 'Audio payload size:', audioBuffer.length);
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
    if (session.customerData && session.agentData && session.businessData) {
      const systemPrompt = generatePrompt(session.agentData, session.customerData, session.businessData);
      session.messages = [{ role: 'system', content: systemPrompt }];
    }
  } catch (err) {
    console.error('[VoiceLink Load Data Error]', err.message);
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

module.exports = { router, setupVoiceLinkWebSocket };
