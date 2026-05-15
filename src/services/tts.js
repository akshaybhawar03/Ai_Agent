const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

/**
 * Generates speech via Sarvam AI and converts to requested format (ALAW or MULAW).
 */
/**
 * Generates speech via Sarvam AI in MP3 format.
 */
async function generateTTS(text) {
  try {
    console.log(`[Sarvam TTS] Generating MP3 with model: bulbul:v3`);
    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code: 'hi-IN',
        speaker: 'shubh',
        model: 'bulbul:v3',
        pace: 1.1,
        speech_sample_rate: 16000,
        enable_preprocessing: true,
        audio_format: 'mp3' // Changed to mp3 for maximum compatibility
      })
    });

    if (!response.ok) {
      console.error('[Sarvam TTS Error]', await response.text());
      return null;
    }

    const data = await response.json();
    const audioBuffer = Buffer.from(data.audios[0], 'base64');
    console.log(`[TTS] MP3 ready:`, audioBuffer.length, 'bytes');

    return audioBuffer;

  } catch (err) {
    console.error('[TTS Error Global]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
