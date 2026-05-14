const textToSpeech = require('@google-cloud/text-to-speech');
const { utaw } = require('alawmulaw');

// Initialize Google TTS client
const client = new textToSpeech.TextToSpeechClient();

/**
 * Generates premium Hindi speech using Google Cloud Wavenet.
 * Uses LINEAR16 at 8kHz and converts to mulaw for perfect telephony quality.
 */
async function generateTTS(text) {
  try {
    console.log('[Google TTS] Generating via Wavenet-B (Hindi Male)...');

    const request = {
      input: { text: text },
      voice: { 
        languageCode: 'hi-IN', 
        name: 'hi-IN-Wavenet-B' // Premium Wavenet voice
      },
      audioConfig: {
        audioEncoding: 'LINEAR16', // Raw 16-bit PCM as requested
        sampleRateHertz: 8000,     // 8kHz for VoiceLink
        pitch: 0,
        speakingRate: 1.0
      },
    };

    // Performs the text-to-speech request
    const [response] = await client.synthesizeSpeech(request);
    
    // response.audioContent is a Buffer containing raw LINEAR16 (PCM) data
    const pcmBuffer = response.audioContent;
    
    console.log('[Google TTS] PCM received, size:', pcmBuffer.length, 'bytes');

    // Use professional 'alawmulaw' package for conversion
    // LINEAR16 (16-bit) to PCMU (8-bit mulaw)
    // The library expects an array of 16-bit samples
    const pcmSamples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
    const mulawSamples = utaw.encode(pcmSamples);
    const mulawBuffer = Buffer.from(mulawSamples);
    
    console.log('[Google TTS] Mulaw success (via alawmulaw)! size:', mulawBuffer.length, 'bytes');
    return mulawBuffer;

  } catch (err) {
    console.error('[Google TTS Error]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
