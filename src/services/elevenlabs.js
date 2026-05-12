const https = require('https');

/**
 * Convert text to speech using ElevenLabs API
 * Returns a Buffer of audio data (mp3)
 */
async function textToSpeech(text, apiKey, voiceId) {
  const key = apiKey || process.env.ELEVENLABS_API_KEY;
  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': key
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.5,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs TTS failed: ${response.status} - ${err}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Get available voices
 */
async function getVoices(apiKey) {
  const key = apiKey || process.env.ELEVENLABS_API_KEY;
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': key }
  });

  if (!response.ok) throw new Error('Failed to fetch voices');
  const data = await response.json();
  return data.voices;
}

module.exports = { textToSpeech, getVoices };
