/**
 * Generates high-fidelity Indian speech using Sarvam AI's raw PCM output.
 * Manual PCM-to-Mulaw conversion for zero-distortion telephony audio.
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
        speaker: 'arya', // Switching to Arya (Female) for better natural tone
        model: 'bulbul:v2',
        pitch: 0,
        pace: 1.0,
        loudness: 1.0, // Reduced from 1.2 to prevent clipping/distortion
        speech_sample_rate: 8000,
        enable_preprocessing: true,
        audio_format: 'pcm' // Requested RAW PCM to avoid WAV header issues
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Sarvam TTS Error]', response.status, errText);
      return null;
    }

    const data = await response.json();
    const base64Audio = data.audios[0];
    
    // Sarvam returns base64 raw PCM when audio_format is 'pcm'
    const pcmBuffer = Buffer.from(base64Audio, 'base64');
    
    console.log('[Sarvam TTS] Raw PCM received, size:', pcmBuffer.length, 'bytes');

    // Manually convert raw PCM 16-bit LE to 8-bit Mulaw
    const mulawBuffer = pcmToMulaw(pcmBuffer);
    
    console.log('[Sarvam TTS] Mulaw conversion success, size:', mulawBuffer.length, 'bytes');
    return mulawBuffer;

  } catch (err) {
    console.error('[TTS Error]', err.message);
    return null;
  }
}

/**
 * Converts 16-bit Linear PCM to 8-bit u-law (mulaw).
 */
function pcmToMulaw(pcmBuffer) {
  const MULAW_BIAS = 33;
  const mulawBuffer = Buffer.alloc(pcmBuffer.length / 2);
  
  for (let i = 0; i < mulawBuffer.length; i++) {
    let sample = pcmBuffer.readInt16LE(i * 2);
    
    let sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;
    if (sample > 32635) sample = 32635;
    
    sample += MULAW_BIAS;
    
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);
    
    let mantissa = (sample >> (exponent + 3)) & 0x0F;
    let res = ~(sign | (exponent << 4) | mantissa) & 0xFF;
    
    mulawBuffer[i] = res;
  }
  
  return mulawBuffer;
}

module.exports = { generateTTS };
