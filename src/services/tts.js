const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

/**
 * Generates speech via Cartesia and applies professional audio normalization.
 * Limits peaks to -6dB to strictly prevent any distortion/cracking.
 */
async function generateTTS(text) {
  try {
    console.log('[Cartesia TTS] Generating High-Quality PCM...');

    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'Cartesia-Version': '2024-06-10',
        'X-API-Key': process.env.CARTESIA_API_KEY || 'sk_car_kQjNE9rPCa4eaD8xzsMkPx',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model_id: 'sonic-multilingual',
        transcript: text,
        voice: {
          mode: 'id',
          id: 'be79f378-47fe-4f9c-b92b-f02cefa62ccf' // Sunil
        },
        output_format: {
          container: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: 8000
        },
        loudness: 1.0, 
        language: 'hi'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Cartesia Error]', response.status, errText);
      return null;
    }

    const pcmBuffer = Buffer.from(await response.arrayBuffer());

    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tmpPcm = path.join(os.tmpdir(), `tts_${id}.pcm`);
    const tmpMulaw = path.join(os.tmpdir(), `tts_${id}.raw`);

    fs.writeFileSync(tmpPcm, pcmBuffer);

    // Advanced audio filtering:
    // 1. volume=0.5: Reduce overall gain to prevent initial clipping
    // 2. compand: Smooth out the dynamic range
    // 3. alimiter: Hard limit at -6dB to ensure zero distortion
    const result = spawnSync(ffmpeg.path, [
      '-f', 's16le',
      '-ar', '8000',
      '-ac', '1',
      '-i', tmpPcm,
      '-af', 'volume=0.5,compand=attacks=0.3:decays=0.8:points=-90/-90|-20/-20|-5/-15|0/-15,alimiter=limit=0.5:level=1',
      '-acodec', 'pcm_mulaw',
      '-f', 'mulaw',
      tmpMulaw,
      '-y'
    ], { stdio: 'pipe' });

    if (result.status !== 0) {
      console.error('[FFmpeg Error]', result.stderr?.toString().slice(-300));
      return null;
    }

    const mulawBuffer = fs.readFileSync(tmpMulaw);
    console.log('[TTS] Normalized Mulaw ready:', mulawBuffer.length, 'bytes');

    try {
      if (fs.existsSync(tmpPcm)) fs.unlinkSync(tmpPcm);
      if (fs.existsSync(tmpMulaw)) fs.unlinkSync(tmpMulaw);
    } catch (e) {}

    return mulawBuffer;

  } catch (err) {
    console.error('[TTS Error Global]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
