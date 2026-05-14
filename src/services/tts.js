const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

/**
 * Generates speech via Sarvam AI and converts to Official VoiceLink A-LAW format.
 */
async function generateTTS(text) {
  try {
    console.log('[Sarvam TTS] Generating WAV...');
    
    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY || '68c70428-2b81-42e7-8178-01316b251874',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code: 'hi-IN',
        speaker: 'shubh',
        model: 'bulbul:v1',
        pitch: 0,
        pace: 1.0,
        loudness: 1.5,
        speech_sample_rate: 22050,
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
    const tmpAlaw = path.join(os.tmpdir(), `tts_${id}.alaw`);

    fs.writeFileSync(tmpWav, wavBuffer);

    // Official VoiceLink Format: ALAW, 8000Hz, Mono
    const result = spawnSync(ffmpeg.path, [
      '-i', tmpWav,
      '-ar', '8000',
      '-ac', '1',
      '-acodec', 'pcm_alaw',
      '-f', 'alaw',
      tmpAlaw,
      '-y'
    ], { stdio: 'pipe' });

    if (result.status !== 0) {
      console.error('[FFmpeg Error]', result.stderr?.toString().slice(-200));
      return null;
    }

    const alawBuffer = fs.readFileSync(tmpAlaw);
    console.log('[TTS] ALAW ready for VoiceLink:', alawBuffer.length, 'bytes');

    try { fs.unlinkSync(tmpWav); } catch {}
    try { fs.unlinkSync(tmpAlaw); } catch {}

    return alawBuffer;

  } catch (err) {
    console.error('[TTS Error Global]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
