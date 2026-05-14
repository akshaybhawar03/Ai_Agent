const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

/**
 * Generates high-quality speech from text using Microsoft Edge's free TTS service.
 * @param {string} text - The text to convert to speech.
 * @param {string} gender - 'male' or 'female' to select the voice.
 * @returns {Promise<Buffer|null>} - Audio buffer in MP3 format.
 */
async function generateTTS(text, gender = 'female') {
  try {
    const tts = new MsEdgeTTS();
    
    // Select natural sounding Hindi neural voices
    const voice = gender === 'male' ? 'hi-IN-MadhurNeural' : 'hi-IN-SwaraNeural';
    
    await tts.setMetadata(
      voice,
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
    );

    // Use destructuring to get the actual audioStream
    const { audioStream } = await tts.toStream(text);
    
    const chunks = [];
    return new Promise((resolve, reject) => {
      audioStream.on('data', chunk => chunks.push(chunk));
      audioStream.on('end', () => resolve(Buffer.concat(chunks)));
      audioStream.on('error', (err) => {
        console.error('[TTS Stream Error]', err);
        reject(err);
      });
    });
  } catch (err) {
    console.error('[TTS Error]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
