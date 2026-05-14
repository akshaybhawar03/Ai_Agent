const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

/**
 * Generates speech via Cartesia in High-Quality PCM and converts to 
 * professional-grade Mu-law using FFmpeg for zero distortion.
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
          encoding: 'pcm_s16le', // High-quality 16-bit PCM
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

    // Professional conversion using FFmpeg for zero distortion
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tmpPcm = path.join(os.tmpdir(), `tts_${id}.pcm`);
    const tmpMulaw = path.join(os.tmpdir(), `tts_${id}.raw`);

    fs.writeFileSync(tmpPcm, pcmBuffer);

    const result = spawnSync(ffmpeg.path, [
      '-f', 's16le',       // input is raw 16-bit PCM
      '-ar', '8000',      // at 8kHz
      '-ac', '1',         // mono
      '-i', tmpPcm,
      '-acodec', 'pcm_mulaw', // convert to mulaw
      '-f', 'mulaw',      // output format raw mulaw
      tmpMulaw,
      '-y'
    ], { stdio: 'pipe' });

    if (result.status !== 0) {
      console.error('[FFmpeg Error]', result.stderr?.toString().slice(-300));
      return null;
    }

    const mulawBuffer = fs.readFileSync(tmpMulaw);
    console.log('[TTS] Professional Mulaw ready:', mulawBuffer.length, 'bytes');

    // Cleanup
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
