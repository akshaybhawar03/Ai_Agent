const sdk = require('microsoft-cognitiveservices-speech-sdk');

/**
 * Generate high-quality Hindi speech using Azure Cognitive Services
 */
async function generateTTS(text) {
  return new Promise((resolve, reject) => {
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY,
      process.env.AZURE_SPEECH_REGION || 'eastus'
    );
    
    // hi-IN-MadhurNeural is a very natural Hindi male voice
    speechConfig.speechSynthesisVoiceName = "hi-IN-MadhurNeural";
    
    // Output as MP3 for Twilio compatibility
    speechConfig.speechSynthesisOutputFormat = 
      sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;
    
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
    
    synthesizer.speakTextAsync(
      text,
      result => {
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolve(Buffer.from(result.audioData));
        } else {
          reject(new Error(`Azure TTS Error: ${result.errorDetails}`));
        }
        synthesizer.close();
      },
      error => {
        reject(error);
        synthesizer.close();
      }
    );
  });
}

module.exports = { generateTTS };
