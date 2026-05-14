const { utaw } = require('alawmulaw');

/**
 * Generates high-fidelity Indian speech using Sarvam AI's raw PCM output.
 * Uses the professional 'alawmulaw' package for perfect telephony conversion.
 */
async function generateTTS(text) {
  try {
    if (!process.env.SARVAM_API_KEY) {
      console.error('[Sarvam TTS] SARVAM_API_KEY is missing');
      return null;
    }

    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code: 'hi-IN',
        speaker: 'arya', // High quality female neural voice
        model: 'bulbul:v2',
        pitch: 0,
        pace: 1.0,
        loudness: 1.0,
        speech_sample_rate: 8000,
        enable_preprocessing: true,
        audio_format: 'pcm' // This is LINEAR16 @ 8kHz
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Sarvam TTS Error]', response.status, errText);
      return null;
    }

    const data = await response.json();
    const base64Audio = data.audios[0];
    
    // Sarvam returns base64 raw PCM (LINEAR16)
    const pcmBuffer = Buffer.from(base64Audio, 'base64');
    
    console.log('[Sarvam TTS] Raw PCM received, size:', pcmBuffer.length, 'bytes');

    // Use professional 'alawmulaw' package for conversion
    // LINEAR16 (16-bit) to PCMU (8-bit mulaw)
    const pcmSamples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
    const mulawSamples = utaw.encode(pcmSamples);
    const mulawBuffer = Buffer.from(mulawSamples);
    
    console.log('[Sarvam TTS] Mulaw success (via alawmulaw)! size:', mulawBuffer.length, 'bytes');
    return mulawBuffer;

  } catch (err) {
    console.error('[TTS Error]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
