const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const { generatePrompt, convertToHindi } = require('../utils/promptGenerator');
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
      deepgramLive: null,
      isSpeaking: false
    };
    sessions.set(sessionId, session);

    try {
      const deepgramLive = deepgram.listen.live({
        model: 'nova-2',
        language: 'hi',
        encoding: 'mulaw',        // Twilio uses MULAW
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
        
            'voicemail', 'please leave', 'press 1', 'press 2', 'for english', 'hindi ke liye',
            'our office hours', 'thank you for calling', 'all our representatives', 'your call is important'
          ];
          
          if (voicemailPhrases.some(phrase => lowerTranscript.includes(phrase))) {
            console.log('[VoiceLink] Voicemail/IVR detected, ending call');
            ws.close();
            return;
          }

          // Special Handling for "Yes/Haan" - Bypass AI for speed and accuracy
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
          
          const aiText = getAIResponse(session, transcript);
          if (aiText) {
            await sendAudio(session, aiText);
          }
        } catch (err) {
          console.error('[VoiceLink AI Error]', err.message);
        }
      });

      session.deepgramLive = deepgramLive;

      // Timeout: If no stream_sid received in 15 seconds, close connection
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
        
        // Bug 1 & 2 Fix: Stream SID and Customer ID Capture
        const currentSid = message.streamSid || message.stream_sid || (message.start && message.start.stream_sid);
        
        if (currentSid && !session.streamSid) {
          session.streamSid = currentSid;
          console.log(`[VoiceLink SID ${sessionId}] Captured: ${session.streamSid}`);
          
          // Bug 2 Fix: Get customer_id from Twilio custom parameters or URL
          const customParams = (message.start && (message.start.customParameters || message.start.custom_parameters)) || {};
          const extractedCustomerId = customParams.customer_id || 
                             customParams['customer_id'] ||
                             new URLSearchParams((session.wsUrl || '').split('?')[1] || '').get('customer_id');
          
          console.log('[VoiceLink] Extracted Customer ID:', extractedCustomerId);

          // ONLY trigger greeting once session context is fully established
          if (!session.isGreetingSent) {
            session.isGreetingSent = true;
            await loadSessionData(session, message.start || {}, extractedCustomerId);
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
      sessions.delete(sessionId);
    });
  });
}

async function sendAudio(session, text) {
  try {
    const isTwilio = session.streamSid?.startsWith('MZ');
    const encoding = isTwilio ? 'mulaw' : 'alaw';
    
    const audioBuffer = await generateTTS(text, encoding);
    if (!audioBuffer || session.ws.readyState !== 1) return;

    // Set speaking flag before sending
    session.isSpeaking = true;

    let payload;
    if (isTwilio) {
      // Twilio format
      payload = JSON.stringify({
        event: 'media',
        streamSid: session.streamSid,
        media: {
          payload: audioBuffer.toString('base64')
        }
      });
    } else {
      // VoiceLink format
      payload = JSON.stringify({
        event: 'media',
        media: {
          payload: audioBuffer.toString('base64')
        }
      });
    }

    session.ws.send(payload);
    console.log('[Audio Sent]', isTwilio ? 'Twilio' : 'VoiceLink', 
      'size:', audioBuffer.length);

    // After roughly the duration of audio, set speaking to false
    // 8000Hz, 1 byte per sample = 8000 bytes/sec
    const durationMs = (audioBuffer.length / 8) + 500; 
    setTimeout(() => {
      session.isSpeaking = false;
    }, durationMs);

  } catch (err) {
    console.error('[Send Audio Error]', err.message);
    session.isSpeaking = false;
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
    if (session.customerData) {
      session.customerData.amountHindi = convertToHindi(session.customerData.amount_due || 0);
    }
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

function getAIResponse(session, userText) {
  const lower = userText.toLowerCase().trim();
  const customerName = session.customerData?.customer_name || 'ji';
  const amountHindi = session.customerData?.amountHindi || 'aapka payment';
  
  // Track last intent to avoid repeating exact same phrase
  if (!session.lastIntent) session.lastIntent = 'none';

  // 1. DATE DETECTED - Commitment found
  const dateWords = ['kal', 'parson', 'din mein', 'din me', 'hafte', 'week', 'mahine', 'tarikh', 
    'kar dunga', 'kar dungi', 'kar deta', 'kar deti', 'ho jayega', 'ho jayegi', 'do din', 'teen din', 
    'char din', 'paanch din', 'somwar', 'mangal', 'budh', 'shukra', 'shanivaar', 'monday', 'tuesday', 
    'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'tarikh ko', 'tak kar',
    'कल', 'परसों', 'दिन में', 'हफ्ते', 'महीने', 'तारीख', 'कर दूंगा', 'कर दूंगी', 'हो जाएगा', 'हो जाएगी', 
    'दो दिन', 'सोमवार', 'मंगलवार', 'बुधवार', 'शुक्रवार', 'शनिवार', 'रविवार', 'पक्का', 'pakka'];
  
  if (dateWords.some(w => lower.includes(w))) {
    session.callEnded = true;
    session.lastIntent = 'date_fixed';
    setTimeout(() => session.ws?.close(), 8000);
    const res = `Bilkul ji! Note kar liya. Dhanyawad ${customerName} ji, namaskar!`;
    session.transcript.push({ role: 'agent', text: res });
    return res;
  }

  // 2. AMOUNT QUERY - Customer asks "How much?"
  const amountWords = ['kitna', 'paisa', 'amount', 'kitne', 'payment kitni', 'paise kitne',
    'कितना', 'कितने', 'पैसे', 'अमाउंट', 'पेमेंट कितनी'];
  
  if (amountWords.some(w => lower.includes(w))) {
    session.lastIntent = 'amount_query';
    const res = `Ji, aapka total ${amountHindi} banta hai. Bataiye kab tak kar rahe hain?`;
    session.transcript.push({ role: 'agent', text: res });
    return res;
  }

  // 3. REPEAT / CLARIFY / IDENTITY - Customer asks "What?", "Who?", or "Whose payment?"
  const repeatWords = ['kya', 'kaun', 'who', 'suna nahi', 'boliye', 'phir se', 'kya bola', 'what',
    'kiski', 'kisne', 'kahan se', 'company', 'identity',
    'क्या', 'कौन', 'सुना नहीं', 'फिर से', 'क्या बोला', 'बोलिए', 'किसकी', 'किसने', 'कहाँ से', 'कंपनी'];
  
  if (repeatWords.some(w => lower.includes(w))) {
    const agentName = session.agentData?.agent_name || 'Raj';
    const bizName = session.businessData?.business_name || 'CollectAI';
    
    let res;
    if (lower.includes('kiski') || lower.includes('company') || lower.includes('किसकी') || lower.includes('कंपनी')) {
      res = `Ji, ye ${bizName} ki taraf se call hai. Aapka ${amountHindi} pending hai, wahi clear karna hai.`;
    } else if (session.lastIntent === 'intro') {
      res = `Ji, main ${agentName} bol raha hoon ${bizName} se. Aapke payment ke liye phone kiya tha.`;
    } else {
      res = `Ji, main keh raha tha ki aapka ${amountHindi} pending hai. Kab tak payment ho sakegi?`;
    }
    session.lastIntent = 'clarification';
    session.transcript.push({ role: 'agent', text: res });
    return res;
  }

  // 4. PAID ALREADY
  if (['kar di', 'ho gayi', 'de di', 'paid', 'transfer', 'bhej di', 'pay kar', 'payment ki',
       'कर दी', 'हो गई', 'दे दी', 'पेमेंट कर', 'भेज दी'].some(w => lower.includes(w))) {
    session.callEnded = true;
    session.lastIntent = 'already_paid';
    setTimeout(() => session.ws?.close(), 3000);
    const res = `Bahut achha ji! Main record update kar deta hoon. Dhanyawad, namaskar!`;
    session.transcript.push({ role: 'agent', text: res });
    return res;
  }

  // 5. WRONG NUMBER
  if (['galat', 'wrong', 'koi nahi', 'yahan nahi', 'pata nahi',
       'गलत', 'रॉन्ग', 'कोई नहीं', 'यहाँ नहीं', 'पता नहीं'].some(w => lower.includes(w))) {
    session.callEnded = true;
    session.lastIntent = 'wrong_number';
    setTimeout(() => session.ws?.close(), 2000);
    const res = `Maafi chahta hoon ji, shayad galat number lag gaya. Namaskar!`;
    session.transcript.push({ role: 'agent', text: res });
    return res;
  }

  // 6. BUSY / CALL BACK
  if (['busy', 'baad mein', 'baad me', 'abhi nahi', 'meeting', 'kaam', 'baad',
       'बिजी', 'बाद में', 'अभी नहीं', 'मीटिंग', 'काम'].some(w => lower.includes(w))) {
    session.lastIntent = 'busy';
    const res = `Theek hai ji, abhi busy hain toh main kal phone karun? Kaunsa time theek rahega?`;
    session.transcript.push({ role: 'agent', text: res });
    return res;
  }

  // 7. YES / HAAN / AFFIRMATIVE
  if (['haan', 'ha ', 'haa', 'yes', 'bilkul', 'zaroor', 'theek', 'okay', 'ok', 'ji',
       'हाँ', 'हा', 'यस', 'बिलकुल', 'ज़ुरूर', 'ठीक', 'ओके', 'जी'].some(w => lower.includes(w)) 
       && lower.length < 15) {
    
    let res;
    if (session.lastIntent === 'date_ask') {
      res = `Theek hai, toh kal ki date pakki samjhu main?`;
    } else {
      res = `Ji, toh bataiye kab tak payment kar denge? Kal ya parson?`;
    }
    session.lastIntent = 'date_ask';
    session.transcript.push({ role: 'agent', text: res });
    return res;
  }

  // 8. DEFAULT FALLBACK
  let res;
  if (session.lastIntent === 'default') {
    res = `Ji, aapki payment kafi time se pending hai. Ek confirm date bata dijiye taaki main note kar sakun.`;
  } else {
    res = `Theek hai ji, toh kab tak payment ho sakegi? Ek date bata dijiye.`;
  }
  session.lastIntent = 'default';
  session.transcript.push({ role: 'agent', text: res });
  return res;
}

module.exports = { router, setupVoiceLinkWebSocket };
