const textToSpeech = require('@google-cloud/text-to-speech');

/**
 * Convert text to speech using Google Cloud TTS
 */
async function generateTTS(text, voiceType = 'onyx') {
  // Map our internal voice names to Google Cloud voices
  // hi-IN-Wavenet-C: Male
  // hi-IN-Wavenet-A or D: Female
  const isFemale = voiceType === 'nova';
  const voiceName = isFemale ? 'hi-IN-Wavenet-D' : 'hi-IN-Wavenet-C';
  const gender = isFemale ? 'FEMALE' : 'MALE';

  const client = new textToSpeech.TextToSpeechClient({
    apiKey: process.env.GOOGLE_TTS_API_KEY
  });

  const request = {
    input: { text },
    voice: {
      languageCode: 'hi-IN',
      name: voiceName,
      ssmlGender: gender
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 1.1, // Slightly faster for natural feel
      pitch: 0
    }
  };

  try {
    const [response] = await client.synthesizeSpeech(request);
    return response.audioContent; // Buffer
  } catch (error) {
    console.error('[Google TTS] Error:', error.message);
    throw error;
  }
}

module.exports = { generateTTS };
