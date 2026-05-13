const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const { generatePrompt } = require('../utils/promptGenerator');
const { detectOutcome } = require('../utils/outcomeDetector');
const { createClient } = require('@deepgram/sdk');
const OpenAI = require('openai');
const textToSpeech = require('@google-cloud/text-to-speech');
const { supabaseAdmin: supabase } = require('../services/supabase');

// Initialize clients lazily to prevent crash if keys are missing
let deepgram = null;
let openai = null;
let ttsClient = null;

function initClients() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  
  if (!deepgram && process.env.DEEPGRAM_API_KEY) {
    deepgram = createClient(process.env.DEEPGRAM_API_KEY);
  }
  
  if (!ttsClient && process.env.GOOGLE_TTS_API_KEY) {
    try {
      ttsClient = new textToSpeech.TextToSpeechClient({
        apiKey: process.env.GOOGLE_TTS_API_KEY
      });
    } catch (e) {
      console.error('[VoiceLink] Failed to init Google TTS:', e.message);
    }
  }
}

// Store active sessions
const sessions = new Map();

// WebSocket handler for VoiceLink
function setupVoiceLinkWebSocket(wss) {
  wss.on('connection', async (ws, req) => {
    initClients();
    
    if (!deepgram || !openai || !ttsClient) {
      console.error('[VoiceLink WS] Missing API keys. Cannot process call.');
      ws.send(JSON.stringify({ type: 'error', message: 'Server configuration missing' }));
      ws.close();
      return;
    }

    const sessionId = req.url.split('?')[0].split('/').pop() || Date.now().toString();
    console.log('[VoiceLink WS] Connected:', sessionId);

    const session = {
      id: sessionId,
      ws,
      transcript: [],
      messages: [],
      customerData: null,
      agentData: null,
      businessData: null,
      isGreeting: true,
      deepgramLive: null
    };
    sessions.set(sessionId, session);

    try {
      // Setup Deepgram live transcription
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

        console.log('[VoiceLink STT]', transcript);
        session.transcript.push({ role: 'customer', text: transcript });

        // Get AI response
        const aiResponse = await getAIResponse(session, transcript);
        if (aiResponse) {
          // Convert to audio and send back
          const audioBuffer = await textToSpeechConvert(aiResponse);
          if (audioBuffer && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'audio',
              data: audioBuffer.toString('base64'),
              encoding: 'mp3'
            }));
          }
        }
      });

      deepgramLive.on('error', (err) => {
        console.error('[VoiceLink] Deepgram Error:', err);
      });

      session.deepgramLive = deepgramLive;
    } catch (err) {
      console.error('[VoiceLink] Deepgram Setup Error:', err);
    }

    // Handle incoming messages from VoiceLink
    ws.on('message', async (data) => {
      try {
        // Try to parse as JSON first (control messages)
        const message = JSON.parse(data.toString());
        
        if (message.type === 'start') {
          // Call started - load customer data
          console.log('[VoiceLink] Call started:', message);
          await loadSessionData(session, message);
          
          // Send greeting
          const greeting = await generateGreeting(session);
          const audioBuffer = await textToSpeechConvert(greeting);
          if (audioBuffer && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'audio',
              data: audioBuffer.toString('base64'),
              encoding: 'mp3'
            }));
          }
        } else if (message.type === 'stop') {
          await handleCallEnd(session);
        }
      } catch {
        // Binary audio data from customer
        if (session.deepgramLive && session.deepgramLive.getReadyState() === 1) {
          session.deepgramLive.send(data);
        }
      }
    });

    ws.on('close', async () => {
      console.log('[VoiceLink WS] Disconnected:', sessionId);
      if (session.deepgramLive) {
        session.deepgramLive.finish();
      }
      await handleCallEnd(session);
      sessions.delete(sessionId);
    });

    ws.on('error', (err) => {
      console.error('[VoiceLink WS] Error:', err);
    });
  });
}

async function loadSessionData(session, message) {
  try {
    // Get customer from phone number
    const phone = message.from || message.caller_id;
    if (phone) {
      const { data: customer } = await supabase
        .from('customers')
        .select('*')
        .or(`phone.eq.${phone},phone.eq.${phone.replace('+91', '')}`)
        .single();
      session.customerData = customer;
    }

    // Get agent config
    const { data: agent } = await supabase
      .from('agent_config')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .single();
    session.agentData = agent;

    // Get business profile
    const { data: business } = await supabase
      .from('business_profile')
      .select('*')
      .limit(1)
      .single();
    session.businessData = business;

    if (session.customerData && session.agentData && session.businessData) {
      const systemPrompt = generatePrompt(session.agentData, session.customerData, session.businessData);
      session.messages = [{ role: 'system', content: systemPrompt }];
    }
  } catch (err) {
    console.error('[VoiceLink] Data Load Error:', err.message);
  }
}

async function generateGreeting(session) {
  if (!session.agentData || !session.customerData) {
    return 'Namaste! Main aapka AI assistant bol raha hoon. Kaise madad kar sakta hoon?';
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

    // Check if call should end
    if (aiText.toLowerCase().includes('namaste') && session.messages.length > 4) {
      setTimeout(() => session.ws?.close(), 3000);
    }

    return aiText;
  } catch (err) {
    console.error('[VoiceLink] OpenAI Error:', err.message);
    return 'Maaf kijiye, kuch technical error hai.';
  }
}

async function textToSpeechConvert(text) {
  try {
    // 1. Try Google TTS if key is present
    if (ttsClient) {
      const request = {
        input: { text },
        voice: {
          languageCode: 'hi-IN',
          name: 'hi-IN-Wavenet-C',
          ssmlGender: 'MALE'
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.1
        }
      };
      const [response] = await ttsClient.synthesizeSpeech(request);
      return response.audioContent;
    } 
    
    // 2. Fallback to OpenAI TTS (since user already has this key)
    if (openai) {
      console.log('[VoiceLink] Using OpenAI TTS fallback');
      const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: "onyx", // Best for Hindi male
        input: text,
      });
      const buffer = Buffer.from(await mp3.arrayBuffer());
      return buffer;
    }

    return null;
  } catch (err) {
    console.error('[TTS Error]', err.message);
    return null;
  }
}

async function handleCallEnd(session) {
  if (session.transcript.length === 0) return;
  
  const fullTranscript = session.transcript
    .map(t => `${t.role}: ${t.text}`)
    .join('\n');

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

      // Update customer status
      await supabase.from('customers').update({
        status: outcome.outcome,
        last_call_date: new Date()
      }).eq('id', session.customerData.id);
    }
  } catch (err) {
    console.error('[Call End Error]', err);
  }
}

// Helper to ensure we have a valid token
async function ensureAuthenticated() {
  if (process.env.VOICELINK_API_KEY) return process.env.VOICELINK_API_KEY;

  try {
    if (!process.env.VOICELINK_USERNAME || !process.env.VOICELINK_PASSWORD) {
      return null;
    }
    console.log('[VoiceLink] Authenticating via login...');
    const response = await fetch('https://app.voicelink.co.in/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.VOICELINK_USERNAME,
        password: process.env.VOICELINK_PASSWORD
      })
    });

    const data = await response.json();
    if (data.token) {
      console.log('[VoiceLink] Login successful');
      return data.token;
    }
    throw new Error(data.message || 'Login failed');
  } catch (err) {
    console.error('[VoiceLink Auth Error]', err.message);
    return null;
  }
}

// Webhook endpoint for VoiceLink events
router.post('/webhook', async (req, res) => {
  console.log('[VoiceLink Webhook]', req.body);
  res.json({ status: 'ok' });
});

// Outbound call trigger via VoiceLink API
router.post('/call', async (req, res) => {
  try {
    const { customerId } = req.body;
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const token = await ensureAuthenticated();
    if (!token) return res.status(401).json({ error: 'VoiceLink authentication failed' });

    console.log(`[VoiceLink] Initiating call to ${customer.phone}`);

    const response = await fetch('https://app.voicelink.co.in/api/v1/calls/outbound', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        to: customer.phone,
        from: process.env.VOICELINK_DID_NUMBER,
        trunk_id: process.env.VOICELINK_TRUNK_ID,
        websocket_url: `${process.env.WEBHOOK_BASE_URL.replace('https', 'wss')}/voicelink/ws`
      })
    });

    const data = await response.json();
    res.json({ success: true, call: data });
  } catch (err) {
    console.error('[VoiceLink Call Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setupVoiceLinkWebSocket };
