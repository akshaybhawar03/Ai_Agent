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
const getTtsUrl = (text, sessionId, voice = 'onyx') => {
  try {
    const baseUrl = process.env.WEBHOOK_BASE_URL || '';
    if (!baseUrl) return null; // Return null if no base URL
    return `${baseUrl}/webhook/twilio/tts?text=${encodeURIComponent(text)}&sessionId=${sessionId}&voice=${voice}`;
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
    const session = getSession(sessionId);
    if (!session) {
      console.error(`[Twilio Voice] Session not found: ${sessionId}`);
      response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Sorry, kuch technical problem hai. Namaste.');
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    // Generate initial greeting
    console.log(`[Twilio Voice] Generating greeting...`);
    const result = await processConversation(sessionId, null);
    console.log(`[Twilio Voice] AI Response: ${result.response}`);

    const ttsUrl = getTtsUrl(result.response, sessionId, result.voice);
    if (ttsUrl) {
      response.play(ttsUrl);
    }
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, result.response);
    
    const gather = response.gather({
      input: 'speech',
      language: 'hi-IN',
      speechTimeout: 'auto',
      action: `/webhook/twilio/gather?sessionId=${sessionId}`,
      method: 'POST',
      timeout: 5
    });

    // If no response, retry once
    response.play(getTtsUrl('Hello? Kya aap sun rahe hain?', sessionId));
    const gather2 = response.gather({
      input: 'speech',
      language: 'hi-IN',
      speechTimeout: 'auto',
      action: `/webhook/twilio/gather?sessionId=${sessionId}`,
      method: 'POST',
      timeout: 5
    });

    response.play(getTtsUrl('Theek hai, main baad mein call karunga. Namaste!', sessionId));
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Theek hai, main baad mein call karunga. Namaste!');
    response.hangup();
  } catch (error) {
    console.error('Voice webhook error:', error);
    response.play(getTtsUrl('Sorry, technical problem. Namaste.', sessionId));
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Sorry, technical problem. Namaste.');
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
    const session = getSession(sessionId);
    if (!session || !speechResult) {
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    console.log(`[Twilio Gather] User Speech: ${speechResult}`);
    const result = await processConversation(sessionId, speechResult);
    console.log(`[Twilio Gather] AI Response: ${result.response}`);

    const ttsUrl = getTtsUrl(result.response, sessionId, result.voice);
    if (ttsUrl) {
      response.play(ttsUrl);
    }
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, result.response);

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
    }
  } catch (error) {
    console.error('Gather webhook error:', error);
    response.play(getTtsUrl('Namaste!', sessionId));
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Namaste!');
    response.hangup();
  }

  res.type('text/xml').send(response.toString());
});

// POST /webhook/twilio/status - Call status updates
router.post('/status', async (req, res) => {
  const sessionId = req.query.sessionId;
  const { CallStatus, CallDuration, RecordingUrl } = req.body;

  console.log(`[Twilio Status] Session: ${sessionId}, Status: ${CallStatus}`);

  if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus)) {
    await postCallUpdate(sessionId, {
      duration: parseInt(CallDuration) || 0,
      recordingUrl: RecordingUrl || null
    });
  }

  res.sendStatus(200);
});

// POST /webhook/twilio/recording - Recording callback
router.post('/recording', async (req, res) => {
  console.log('[Twilio Recording]', req.body.RecordingUrl);
  res.sendStatus(200);
});

// GET /webhook/twilio/tts - Dynamic TTS generation for <Play>
router.get('/tts', async (req, res) => {
  const { text, sessionId, voice } = req.query;

  if (!text) return res.status(400).send('Text required');

  try {
    // Generate a unique cache key based on text
    const cacheKey = crypto.createHash('md5').update(text).digest('hex');
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.mp3`);

    // Check if audio is already cached
    if (fs.existsSync(cachePath)) {
      return res.sendFile(cachePath);
    }

    // Otherwise generate new audio using Google TTS (with timeout)
    console.log(`[TTS] Generating new audio with Google Cloud for: "${text.substring(0, 30)}..."`);
    
    let audioBuffer;
    try {
      // Set a 4 second timeout for TTS to prevent Twilio timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TTS Timeout')), 4000)
      );
      
      audioBuffer = await Promise.race([
        generateTTS(text, voice),
        timeoutPromise
      ]);
    } catch (gError) {
      console.warn(`[TTS] Google/Timeout failed: ${gError.message}`);
      // Return 404 to trigger Twilio's native voice fallback immediately
      return res.status(404).send('TTS Failed');
    }

    fs.writeFileSync(cachePath, audioBuffer);
    
    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (error) {
    console.error('TTS Route Error:', error.message);
    res.status(404).send('TTS Failed');
  }
});

module.exports = router;
