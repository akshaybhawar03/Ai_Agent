const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const { generatePrompt, convertToHindi } = require('../utils/promptGenerator');
const { detectOutcome } = require('../utils/outcomeDetector');
const { createClient } = require('@deepgram/sdk');
const { supabaseAdmin: supabase } = require('../services/supabase');
const { triggerVoiceLinkCall } = require('../services/voicelink');
const { generateTTS } = require('../services/tts');
const { formatAmountForSpeech } = require('../utils/hindiNumbers');

// Initialize clients
let deepgram = null;
function initClients() {
  if (!deepgram && process.env.DEEPGRAM_API_KEY) {
    deepgram = createClient(process.env.DEEPGRAM_API_KEY);
  }
}

const activeSessions = new Map();

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
      wsUrl: req.url,
      streamSid: null,
      transcript: [],
      customerData: null,
      agentData: null,
      businessData: null,
      isGreetingSent: false,
      deepgramLive: null,
      isSpeaking: false,
      callEnded: false,
      lastIntent: 'none'
    };
    activeSessions.set(sessionId, session);

    try {
      const deepgramLive = deepgram.listen.live({
        model: 'nova-2',
        language: 'hi',
        encoding: 'mulaw',
        sample_rate: 8000,
        interim_results: true,
        utterance_end_ms: 1000,
        vad_events: true,
        punctuate: true
      });

      deepgramLive.on('open', () => console.log('[VoiceLink] Deepgram STT Ready'));
      
      deepgramLive.addListener('Results', async (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (!transcript?.trim()) return;

        // INTERRUPTION HANDLING (BARGE-IN)
        if (session.isSpeaking && transcript.split(' ').length > 1) {
          console.log('[Barge-in] User interrupted, clearing buffer...');
          if (session.streamSid) {
            ws.send(JSON.stringify({
              event: 'clear',
              streamSid: session.streamSid
            }));
          }
          session.isSpeaking = false;
        }

        if (data.is_final) {
          console.log(`[VoiceLink STT] ${sessionId} ${transcript}`);
          session.transcript.push({ role: 'user', text: transcript });

          // Basic Voicemail/IVR Detection
          const lower = transcript.toLowerCase();
          const voicemailPhrases = ['voicemail', 'not available', 'press 1', 'press 2', 'leave a message'];
          if (voicemailPhrases.some(phrase => lower.includes(phrase))) {
            console.log('[VoiceLink] Voicemail detected, ending.');
            ws.close();
            return;
          }

          if (!session.callEnded) {
            const aiText = getAIResponse(session, transcript);
            if (aiText) {
              await sendAudio(session, aiText);
            }
          }
        }
      });

      session.deepgramLive = deepgramLive;

      setTimeout(() => {
        if (!session.streamSid) {
          console.log('[VoiceLink] No stream SID received in 15s, closing stale connection');
          ws.close();
        }
      }, 15000);

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
          
          const customParams = (message.start && (message.start.customParameters || message.start.custom_parameters)) || {};
          const extractedCustomerId = customParams.customer_id || 
                             customParams['customer_id'] ||
                             new URLSearchParams((session.wsUrl || '').split('?')[1] || '').get('customer_id');
          
          if (!session.isGreetingSent) {
            session.isGreetingSent = true;
            await loadSessionData(session, extractedCustomerId);
            const greeting = await generateGreeting(session);
            if (greeting) await sendAudio(session, greeting);
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
      activeSessions.delete(sessionId);
    });
  });
}

async function sendAudio(session, text) {
  try {
    const isTwilio = session.streamSid?.startsWith('MZ');
    const encoding = isTwilio ? 'mulaw' : 'alaw';
    
    const audioBuffer = await generateTTS(text, encoding);
    if (!audioBuffer || session.ws.readyState !== 1) return;

    session.isSpeaking = true;

    let payload;
    if (isTwilio) {
      payload = JSON.stringify({
        event: 'media',
        streamSid: session.streamSid,
        media: { payload: audioBuffer.toString('base64') }
      });
    } else {
      payload = JSON.stringify({
        event: 'media',
        media: { payload: audioBuffer.toString('base64') }
      });
    }

    session.ws.send(payload);
    console.log('[Audio Sent]', isTwilio ? 'Twilio' : 'VoiceLink', 'size:', audioBuffer.length);

    const durationMs = (audioBuffer.length / 8) + 500; 
    setTimeout(() => {
      session.isSpeaking = false;
    }, durationMs);

  } catch (err) {
    console.error('[Send Audio Error]', err.message);
    session.isSpeaking = false;
  }
}

async function loadSessionData(session, customerId) {
  try {
    if (!customerId) return;
    const { data: customer } = await supabase.from('customers').select('*').eq('id', customerId).single();
    if (customer) {
      customer.amountHindi = formatAmountForSpeech(customer.amount_due || 0);
      session.customerData = customer;
    }
    
    // Correct table names
    const { data: business } = await supabase.from('businesses').select('*').limit(1).single();
    const { data: agent } = await supabase.from('agents').select('*').eq('is_active', true).limit(1).single();
    
    session.businessData = business;
    session.agentData = agent;

    console.log(`[VoiceLink] Session Data Loaded for: ${customer?.customer_name || 'Unknown'}`);
  } catch (err) {
    console.error('[Load Session Data Error]', err.message);
  }
}

async function generateGreeting(session) {
  if (!session.agentData || !session.customerData) return 'Namaste! Main aapka AI assistant bol raha hoon.';
  return `Namaste! Main ${session.agentData.agent_name} bol ra${session.agentData.gender === 'male' ? 'ha' : 'hi'} hoon, ${session.businessData?.business_name || 'CollectAI'} se. Kya main ${session.customerData?.customer_name} ji se baat kar sakta hoon?`;
}

async function handleCallEnd(session) {
  if (session.transcript.length === 0 || !session.customerData) return;
  const fullTranscript = session.transcript.map(t => `${t.role}: ${t.text}`).join('\n');
  try {
    const outcome = await detectOutcome(fullTranscript);
    await supabase.from('call_logs').insert({
      business_id: session.businessData?.id,
      customer_id: session.customerData.id,
      transcript: fullTranscript,
      ai_summary: outcome.summary,
      outcome: outcome.outcome,
      status: 'completed',
      called_at: new Date().toISOString()
    });
    await supabase.from('customers').update({ 
      status: outcome.outcome, 
      last_call_date: new Date() 
    }).eq('id', session.customerData.id);
  } catch (err) {}
}

function getAIResponse(session, userText) {
  const lower = userText.toLowerCase().trim();
  const customerName = session.customerData?.customer_name || 'ji';
  const amountHindi = session.customerData?.amountHindi || 'aapka payment';
  
  if (!session.lastIntent) session.lastIntent = 'none';

  // FEATURE 5: TONE ANALYSIS (SENTIMENT)
  const angryWords = ['badtameez', 'gali', 'police', 'complaint', 'pareshan', 'phone mat kar', 'haram', 'sharam', 'नहीं करूँगा', 'परेशान', 'शिकायत'];
  if (angryWords.some(w => lower.includes(w))) {
    session.lastIntent = 'angry_customer';
    return `Maafi chahta hoon ji, mera maqsad aapko pareshan karna nahi tha. Main bas payment ki yaad dila raha tha. Kab tak baat kar sakte hain hum?`;
  }

  // 1. DATE DETECTED
  const dateWords = ['kal', 'parson', 'din mein', 'hafte', 'week', 'mahine', 'tarikh', 'kar dunga', 'ho jayega', 'कल', 'परसों', 'तारीख', 'कर दूंगा', 'हो जाएगा'];
  if (dateWords.some(w => lower.includes(w))) {
    session.callEnded = true;
    session.lastIntent = 'date_fixed';
    setTimeout(() => session.ws?.close(), 8000);
    return `Bilkul ji! Note kar liya. Dhanyawad ${customerName} ji, namaskar!`;
  }

  // 2. AMOUNT QUERY
  const amountWords = ['kitna', 'paisa', 'amount', 'kitne', 'कितना', 'कितने', 'पैसे'];
  if (amountWords.some(w => lower.includes(w))) {
    session.lastIntent = 'amount_query';
    return `Ji, aapka total ${amountHindi} banta hai. Bataiye kab tak kar rahe hain?`;
  }

  // 3. EXCUSE HANDLING - Customer gives a reason for delay
  const excuseWords = ['salary', 'tanwa', 'paisa nahi', 'medical', 'hospital', 'death', 'freeze', 'problem', 'pareshan', 'majboori', 'dikkat',
    'सैलेरी', 'तनख्वाह', 'पैसा नहीं', 'मेडिकल', 'अस्पताल', 'प्रॉब्लम', 'परेशान', 'मजबूरी', 'दिक्कत', 'बीमार', 'एक्सीडेंट'];
  
  if (excuseWords.some(w => lower.includes(w))) {
    session.lastIntent = 'excuse';
    let res = `Oh, samajh sakta hoon ji, kafi dikkat wali baat hai. Par thoda payment toh karna hi hoga. Kya main aapko 2 din ka waqt de sakta hoon?`;
    if (lower.includes('salary') || lower.includes('सैलेरी')) {
      res = `Theek hai ji, salary aane mein thoda waqt lagta hai samajh sakta hoon. Kaunsi date ko salary aa jayegi?`;
    }
    session.transcript.push({ role: 'agent', text: res });
    return res;
  }

  // 4. IDENTITY / CLARIFY
  const repeatWords = ['kya', 'kaun', 'who', 'kiski', 'company', 'क्या', 'कौन', 'किसकी', 'कंपनी'];
  if (repeatWords.some(w => lower.includes(w))) {
    const agentName = session.agentData?.agent_name || 'Raj';
    const bizName = session.businessData?.business_name || 'CollectAI';
    if (lower.includes('kiski') || lower.includes('company')) {
      return `Ji, ye ${bizName} ki taraf se call hai. Aapka ${amountHindi} pending hai, wahi clear karna hai.`;
    }
    return `Ji, main ${agentName} bol raha hoon ${bizName} se. Kab tak payment ho sakegi?`;
  }

  // 4. PAID ALREADY
  if (['kar di', 'paid', 'कर दी', 'हो गई'].some(w => lower.includes(w))) {
    session.callEnded = true;
    setTimeout(() => session.ws?.close(), 3000);
    return `Bahut achha ji! Main record update kar deta hoon. Dhanyawad, namaskar!`;
  }

  // 7. YES / HAAN
  if (['haan', 'yes', 'theek', 'ok', 'हाँ', 'ठीक'].some(w => lower.includes(w)) && lower.length < 15) {
    let res = (session.lastIntent === 'date_ask') ? `Theek hai, toh kal ki date pakki samjhu main?` : `Ji, toh bataiye kab tak payment kar denge? Kal ya parson?`;
    session.lastIntent = 'date_ask';
    return res;
  }

  // DEFAULT
  session.lastIntent = 'default';
  return `Theek hai ji, toh kab tak payment ho sakegi? Ek date bata dijiye.`;
}

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
