const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

/**
 * Generates natural Indian speech using Sarvam AI (Bulbul model).
 * Provides highly realistic Hindi/Hinglish voices for the Indian context.
 */
async function generateTTS(text, speaker = 'shubh') {
  try {
    if (!process.env.SARVAM_API_KEY) {
      console.error('[Sarvam TTS] SARVAM_API_KEY is missing');
      return null;
    }

    console.log(`[Sarvam TTS] Generating via Bulbul (Speaker: ${speaker})...`);

    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code: 'hi-IN',
        speaker: speaker,
        model: 'bulbul:v2',
        pitch: 0,
        pace: 1.1,
        loudness: 1.5,
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
    
    // Sarvam returns base64 encoded audio in the 'audios' array
    if (!data.audios || !data.audios[0]) {
      throw new Error('No audio returned from Sarvam AI');
    }

    const wavBuffer = Buffer.from(data.audios[0], 'base64');
    console.log('[Sarvam TTS] Received WAV size:', wavBuffer.length, 'bytes');
    
    // Temporary paths for conversion
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tmpWav = path.join(os.tmpdir(), `tts_${requestId}.wav`);
    const tmpRaw = path.join(os.tmpdir(), `tts_${requestId}.raw`);
    
    fs.writeFileSync(tmpWav, wavBuffer);
    
    // Convert WAV to PCMU (mulaw) 8kHz Mono for telephony
    try {
      execSync(
        `"${ffmpeg.path}" -i "${tmpWav}" -acodec pcm_mulaw -ar 8000 -ac 1 -f mulaw "${tmpRaw}" -y`,
        { stdio: 'pipe' }
      );
    } catch (convErr) {
      console.error('[Sarvam TTS] FFmpeg conversion failed:', convErr.stderr?.toString() || convErr.message);
      throw convErr;
    }
    
    const mulawBuffer = fs.readFileSync(tmpRaw);
    console.log('[Sarvam TTS] Mulaw synthesis successful! size:', mulawBuffer.length, 'bytes');
    
    // Cleanup
    try {
      if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
      if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw);
    } catch (e) {}
    
    return mulawBuffer;
    
  } catch (err) {
    console.error('[Sarvam TTS Global Error]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
