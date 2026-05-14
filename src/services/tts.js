const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

/**
 * Generates speech via Sarvam AI at 22050Hz and resamples to 8000Hz mulaw using FFmpeg.
 * This is the standard pipeline required by VoiceLink for clear audio.
 */
async function generateTTS(text) {
  try {
    if (!process.env.SARVAM_API_KEY) {
      console.error('[Sarvam TTS] SARVAM_API_KEY is missing');
      return null;
    }

    // Step 1: Request high-quality 22050Hz WAV from Sarvam
    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code: 'hi-IN',
        speaker: 'hitesh', // Compatibility with v2
        model: 'bulbul:v2', 
        pitch: 0,
        pace: 1.0,
        loudness: 1.5,
        speech_sample_rate: 22050, 
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
    if (!data.audios || !data.audios[0]) {
      throw new Error('No audio returned from Sarvam AI');
    }

    const wavBuffer = Buffer.from(data.audios[0], 'base64');

    // Step 2: Temporary files for conversion
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tmpWav = path.join(os.tmpdir(), `tts_${id}.wav`);
    const tmpMulaw = path.join(os.tmpdir(), `tts_${id}.raw`);

    fs.writeFileSync(tmpWav, wavBuffer);

    // Step 3: Resample to 8000Hz mulaw using FFmpeg
    const result = spawnSync(ffmpeg.path, [
      '-i', tmpWav,
      '-ar', '8000',
      '-ac', '1',
      '-acodec', 'pcm_mulaw',
      '-f', 'mulaw',
      tmpMulaw,
      '-y'
    ], { stdio: 'pipe' });

    if (result.status !== 0) {
      console.error('[ffmpeg Error]', result.stderr?.toString().slice(-300));
      return null;
    }

    const mulawBuffer = fs.readFileSync(tmpMulaw);
    console.log('[TTS] Mulaw ready:', mulawBuffer.length, 'bytes');

    // Step 4: Cleanup
    try {
      if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
      if (fs.existsSync(tmpMulaw)) fs.unlinkSync(tmpMulaw);
    } catch (e) {}

    return mulawBuffer;

  } catch (err) {
    console.error('[TTS Error Global]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
