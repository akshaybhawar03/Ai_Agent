const OpenAI = require('openai');

/**
 * Convert text to speech using OpenAI TTS
 */
async function textToSpeech(text, voice = 'onyx', apiKey) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  
  if (!key) {
    throw new Error('OpenAI API Key is missing');
  }

  const openai = new OpenAI({ apiKey: key });

  const response = await openai.audio.speech.create({
    model: "tts-1",        // fast, low latency
    voice: voice || "onyx", // alloy, echo, fable, onyx, nova, shimmer
    input: text,
    response_format: "mp3"
  });
  
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer;
}

module.exports = { textToSpeech };
