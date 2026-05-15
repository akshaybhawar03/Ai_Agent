/**
 * Twilio Webhook Routes - Handle voice and status callbacks
 */
const express = require('express');
const twilio = require('twilio');
const { processConversation, postCallUpdate, getSession } = require('../services/callEngine');
const { generateTTS } = require('../services/tts');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Create a cache directory for TTS audio
const CACHE_DIR = path.join(__dirname, '../../cache/audio');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const router = express.Router();

// Helper to get TTS URL
const getTtsUrl = (text, sessionId) => {
  try {
    const baseUrl = process.env.WEBHOOK_BASE_URL || '';
    if (!baseUrl) return null;
    return `${baseUrl}/webhook/twilio/tts?text=${encodeURIComponent(text)}&sessionId=${sessionId}`;
  } catch (e) {
    return null;
  }
};

// POST /webhook/twilio/voice - Initial voice webhook
router.post('/voice', async (req, res) => {
  const sessionId = req.query.sessionId;
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  console.log(`[Twilio Voice] Incoming call for session: ${sessionId}`);

  try {
    const session = await getSession(sessionId);
    if (!session) {
      console.error(`[Twilio Voice] Session not found: ${sessionId}`);
      response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Technical problem hai. Namaste.');
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    console.log(`[Twilio Voice] Generating greeting...`);
    const result = await processConversation(sessionId, null);
    console.log(`[Twilio Voice] AI Response: ${result.response}`);

    // Play high-quality Azure TTS
    // Use Twilio's Native Polly Neural Voice (Instant & Reliable)
    response.say({ 
      voice: 'Polly.Aditi-Neural', 
      language: 'hi-IN' 
    }, result.response);
    
    const gather = response.gather({
      input: 'speech',
      language: 'hi-IN',
      speechTimeout: 'auto',
      action: `/webhook/twilio/gather?sessionId=${sessionId}`,
      method: 'POST',
      timeout: 5
    });

    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Hello? Aap sun rahe hain?');
    response.redirect(`/webhook/twilio/voice?sessionId=${sessionId}`);

  } catch (error) {
    console.error('Voice webhook error:', error);
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Sorry, error aa gaya.');
    response.hangup();
  }

  res.type('text/xml').send(response.toString());
});

// POST /webhook/twilio/gather - Handle speech input
router.post('/gather', async (req, res) => {
  const sessionId = req.query.sessionId;
  const speechResult = req.body.SpeechResult;
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  try {
    const session = await getSession(sessionId);
    if (!session) {
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    if (!speechResult) {
      response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Main sun nahi paaya. Phir se boliye?');
      response.redirect(`/webhook/twilio/voice?sessionId=${sessionId}`);
      return res.type('text/xml').send(response.toString());
    }

    console.log(`[Twilio Gather] User Speech: ${speechResult}`);
    const result = await processConversation(sessionId, speechResult);
    console.log(`[Twilio Gather] AI Response: ${result.response}`);

    // Use Twilio's Native Polly Neural Voice (Instant & Reliable)
    response.say({ 
      voice: 'Polly.Aditi-Neural', 
      language: 'hi-IN' 
    }, result.response);

    if (result.shouldEnd) {
      response.hangup();
    } else {
      response.gather({
        input: 'speech',
        language: 'hi-IN',
        speechTimeout: 'auto',
        action: `/webhook/twilio/gather?sessionId=${sessionId}`,
        method: 'POST',
        timeout: 5
      });
      response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Aap sun rahe hain?');
    }
  } catch (error) {
    console.error('Gather webhook error:', error);
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Technical problem.');
    response.hangup();
  }

  res.type('text/xml').send(response.toString());
});

// GET /webhook/twilio/tts - Azure TTS generation
router.get('/tts', async (req, res) => {
  const { text, sessionId } = req.query;
  if (!text) return res.status(400).send('Text required');

  const cacheKey = crypto.createHash('md5').update(text).digest('hex');
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.mp3`);

  try {
    if (fs.existsSync(cachePath)) {
      return res.sendFile(cachePath);
    }

    console.log(`[TTS] Generating Azure audio for: "${text.substring(0, 30)}..."`);
    const audioBuffer = await generateTTS(text);
    fs.writeFileSync(cachePath, audioBuffer);
    
    res.set({
      'Content-Type': 'audio/mp3',
      'Content-Length': audioBuffer.length
    });
    res.send(audioBuffer);
  } catch (error) {
    console.error('[TTS] Azure Error:', error.message);
    res.status(404).send('TTS Failed');
  }
});

// POST /webhook/twilio/status - Status callback
router.post('/status', async (req, res) => {
  const sessionId = req.query.sessionId;
  const callStatus = req.body.CallStatus;
  
  // Try to recover session to update it
  const session = await getSession(sessionId);
  console.log(`[Twilio Status] Session: ${sessionId}, Status: ${callStatus}`);
  if (['completed', 'failed', 'busy', 'no-answer'].includes(callStatus)) {
    try { 
      await postCallUpdate(sessionId, {
        status: callStatus,
        duration: req.body.CallDuration,
        recordingUrl: req.body.RecordingUrl
      }); 
    } catch (e) {
      console.error('[Status Webhook Error]', e.message);
    }
  }
  res.sendStatus(200);
});

// POST /webhook/twilio/recording - Recording callback
router.post('/recording', async (req, res) => {
  const { RecordingUrl, CallSid } = req.body;
  console.log(`[Twilio Recording] CallSid: ${CallSid}, URL: ${RecordingUrl}`);
  
  if (RecordingUrl && CallSid) {
    try {
      const { supabaseAdmin } = require('../services/supabase');
      await supabaseAdmin
        .from('call_logs')
        .update({ recording_url: RecordingUrl })
        .eq('twilio_call_sid', CallSid);
    } catch (e) {
      console.error('[Recording Webhook Error]', e.message);
    }
  }
  res.sendStatus(200);
});

module.exports = router;
