/**
 * Generates raw WAV audio from Sarvam AI.
 * Returning the raw buffer directly to test different VoiceLink formats.
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
        speaker: 'hitesh', // Compatibility with v2
        model: 'bulbul:v2', 
        pitch: 0,
        pace: 1.0,
        loudness: 1.5,
        speech_sample_rate: 8000,
        enable_preprocessing: true,
        audio_format: 'wav'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Sarvam TTS Error]', response.status, errText);
      return null;
    }

    const data = await response.json();
    if (!data.audios || !data.audios[0]) {
      throw new Error('No audio returned from Sarvam AI');
    }

    // Return the base64 decoded WAV buffer directly
    const wavBuffer = Buffer.from(data.audios[0], 'base64');
    console.log('[Sarvam TTS] WAV received, size:', wavBuffer.length, 'bytes');
    return wavBuffer;

  } catch (err) {
    console.error('[TTS Error Global]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
