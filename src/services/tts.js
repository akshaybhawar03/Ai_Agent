const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

/**
 * Generates speech via Sarvam AI and converts to Twilio/Standard Mu-law format.
 */
async function generateTTS(text) {
  try {
    console.log('[Sarvam TTS] Generating WAV with model: bulbul:v3');
    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code: 'hi-IN',
        speaker: 'shubh',
        model: 'bulbul:v3',
        pace: 1.1,
        speech_sample_rate: 16000,
        enable_preprocessing: true,
        audio_format: 'wav'
      })
    });

    if (!response.ok) {
      console.error('[Sarvam TTS Error]', await response.text());
      return null;
    }

    const data = await response.json();
    const wavBuffer = Buffer.from(data.audios[0], 'base64');

    const id = Date.now();
    const tmpWav = path.join(os.tmpdir(), `tts_${id}.wav`);
    const tmpMulaw = path.join(os.tmpdir(), `tts_${id}.mulaw`);

    fs.writeFileSync(tmpWav, wavBuffer);

    // Standard Twilio Format: MULAW, 8000Hz, Mono
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
      console.error('[FFmpeg Error]', result.stderr?.toString().slice(-200));
      return null;
    }

    const mulawBuffer = fs.readFileSync(tmpMulaw);
    console.log('[TTS] MULAW ready for Twilio:', mulawBuffer.length, 'bytes');

    try { fs.unlinkSync(tmpWav); } catch {}
    try { fs.unlinkSync(tmpMulaw); } catch {}

    return mulawBuffer;

  } catch (err) {
    console.error('[TTS Error Global]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
