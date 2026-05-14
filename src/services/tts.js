const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Generates natural-sounding speech using Deepgram's Aura TTS.
 * Returns mulaw audio at 8kHz directly - perfect for telephony.
 */
async function generateTTS(text) {
  try {
    if (!process.env.DEEPGRAM_API_KEY) {
      throw new Error('DEEPGRAM_API_KEY is missing');
    }

    console.log('[TTS] Generating via Deepgram Aura...');

    // Use Aura Asteria for a natural, fast voice
    // encoding=mulaw & sample_rate=8000 ensures it works with VoiceLink without conversion
    const response = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=mulaw&sample_rate=8000&container=none', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[TTS] Deepgram error:', response.status, errText);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const mulawBuffer = Buffer.from(arrayBuffer);
    
    console.log('[TTS] Deepgram mulaw success! size:', mulawBuffer.length, 'bytes');
    return mulawBuffer;

  } catch (err) {
    console.error('[TTS Global Error]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
