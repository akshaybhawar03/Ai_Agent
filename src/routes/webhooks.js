/**
 * Twilio Webhook Routes - Handle voice and status callbacks
 */
const express = require('express');
const twilio = require('twilio');
const { processConversation, postCallUpdate, getSession } = require('../services/callEngine');
const fs = require('fs');
const path = require('path');

const router = express.Router();

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
      response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Maaf kijiye, technical error hai. Namaste.');
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    // Generate initial greeting
    console.log(`[Twilio Voice] Generating greeting...`);
    const result = await processConversation(sessionId, null);
    console.log(`[Twilio Voice] AI Response: ${result.response}`);

    // AI Speaks
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, result.response);
    
    // Listen for response
    const gather = response.gather({
      input: 'speech',
      language: 'hi-IN',
      speechTimeout: 'auto',
      action: `/webhook/twilio/gather?sessionId=${sessionId}`,
      method: 'POST',
      timeout: 5
    });

    // Fallback if they don't say anything
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Hello? Kya aap sun rahe hain?');
    response.redirect(`/webhook/twilio/voice?sessionId=${sessionId}`);

  } catch (error) {
    console.error('Voice webhook error:', error);
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Technical problem hai. Namaste.');
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
    if (!session) {
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    if (!speechResult) {
      // If no speech detected, ask again
      response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Maaf kijiye, main sun nahi paaya. Kya aap phir se kahenge?');
      response.redirect(`/webhook/twilio/voice?sessionId=${sessionId}`);
      return res.type('text/xml').send(response.toString());
    }

    console.log(`[Twilio Gather] User Speech: ${speechResult}`);
    const result = await processConversation(sessionId, speechResult);
    console.log(`[Twilio Gather] AI Response: ${result.response}`);

    // AI Speaks response
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, result.response);

    if (result.shouldEnd) {
      response.hangup();
    } else {
      // Continue listening
      response.gather({
        input: 'speech',
        language: 'hi-IN',
        speechTimeout: 'auto',
        action: `/webhook/twilio/gather?sessionId=${sessionId}`,
        method: 'POST',
        timeout: 5
      });
      // Second fallback
      response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Hello? Aap sun rahe hain?');
    }
  } catch (error) {
    console.error('Gather webhook error:', error);
    response.say({ voice: 'Polly.Aditi-Neural', language: 'hi-IN' }, 'Technical problem. Namaste.');
    response.hangup();
  }

  res.type('text/xml').send(response.toString());
});

// POST /webhook/twilio/status - Status callback
router.post('/status', async (req, res) => {
  const sessionId = req.query.sessionId;
  const callStatus = req.body.CallStatus;
  
  console.log(`[Twilio Status] Session: ${sessionId}, Status: ${callStatus}`);
  
  if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer') {
    try {
      await postCallUpdate(sessionId, callStatus);
    } catch (error) {
      console.error('Status callback error:', error);
    }
  }
  
  res.sendStatus(200);
});

module.exports = router;
