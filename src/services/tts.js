const edgeTTS = require('edge-tts');
const { Readable } = require('stream');

/**
 * Generates high-quality speech from text using Microsoft Edge's free TTS service.
 * No API key required.
 * @param {string} text - The text to convert to speech.
 * @param {string} gender - 'male' or 'female' to select the voice.
 * @returns {Promise<Buffer|null>} - Audio buffer in MP3 format.
 */
async function generateTTS(text, gender = 'female') {
  try {
    const tts = new edgeTTS.EdgeTTS();
    
    // Select the best natural-sounding Hindi neural voice
    const voice = gender === 'male' ? 'hi-IN-MadhurNeural' : 'hi-IN-SwaraNeural';
    
    console.log(`[TTS] Generating speech with voice: ${voice}`);
    
    const chunks = [];
    const stream = await tts.toStream(text, { voice });
    
    return new Promise((resolve, reject) => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        console.log(`[TTS] Generation complete. Buffer size: ${fullBuffer.length} bytes`);
        resolve(fullBuffer);
      });
      stream.on('error', (err) => {
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
