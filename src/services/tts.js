/**
 * Generates natural Indian speech using Sarvam AI and converts to mulaw manually.
 * This approach bypasses ffmpeg for better audio quality and lower latency.
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
        model: 'bulbul:v2', // v2 is required now
        pitch: 0,
        pace: 1.0,
        loudness: 1.2,
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
    const base64Audio = data.audios[0];
    const wavBuffer = Buffer.from(base64Audio, 'base64');
    
    console.log('[Sarvam TTS] WAV received, size:', wavBuffer.length, 'bytes');

    // Skip WAV header (standard 44 bytes) to get raw 16-bit PCM data
    const pcmData = wavBuffer.slice(44);
    
    // Manually convert PCM 16-bit LE to 8-bit Mulaw
    const mulawBuffer = pcmToMulaw(pcmData);
    
    console.log('[Sarvam TTS] Manual Mulaw conversion success, size:', mulawBuffer.length, 'bytes');
    return mulawBuffer;

  } catch (err) {
    console.error('[TTS Error]', err.message);
    return null;
  }
}

/**
 * Converts 16-bit Linear PCM to 8-bit u-law (mulaw).
 * Standard G.711 implementation in pure JavaScript.
 */
function pcmToMulaw(pcmBuffer) {
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;
  const mulawBuffer = Buffer.alloc(pcmBuffer.length / 2);
  
  for (let i = 0; i < mulawBuffer.length; i++) {
    // Read 16-bit signed little-endian sample
    let sample = pcmBuffer.readInt16LE(i * 2);
    
    // Clamp sample to 16-bit range
    sample = Math.max(-32768, Math.min(32767, sample));
    
    let sign = 0;
    if (sample < 0) {
      sign = 0x80;
      sample = -sample;
    }
    
    // Convert to 13-bit range
    sample >>= 2;
    sample += MULAW_BIAS;
    if (sample > MULAW_MAX) sample = MULAW_MAX;
    
    let exp = 7;
    let expMask = 0x1000;
    while (exp > 0 && !(sample & expMask)) {
      exp--;
      expMask >>= 1;
    }
    
    const mantissa = (sample >> (exp + 3)) & 0x0F;
    const mulaw = ~(sign | (exp << 4) | mantissa) & 0xFF;
    
    mulawBuffer[i] = mulaw;
  }
  
  return mulawBuffer;
}

module.exports = { generateTTS };
