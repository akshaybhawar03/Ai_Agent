const axios = require('axios');

/**
 * Convert text to speech using ElevenLabs
 */
async function textToSpeech(text, voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const targetVoiceId = voiceId || process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !targetVoiceId) {
    throw new Error('ElevenLabs API Key or Voice ID is missing');
  }

  try {
    const response = await axios({
      method: 'post',
      url: `https://api.elevenlabs.io/v1/text-to-speech/${targetVoiceId}`,
      data: {
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        }
      },
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
    });

    return Buffer.from(response.data);
  } catch (error) {
    console.error('ElevenLabs Error:', error.response?.data?.toString() || error.message);
    throw error;
  }
}

module.exports = { textToSpeech };
