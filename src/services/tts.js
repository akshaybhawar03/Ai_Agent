const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

/**
 * Generates speech via Cartesia and converts to A-LAW (8000Hz).
 * Switching to A-law as Mu-law is causing distortion, suggesting a protocol mismatch.
 */
async function generateTTS(text) {
  try {
    console.log('[Cartesia TTS] Generating for A-LAW test...');

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
          id: 'faf0731e-dfb9-4cfc-8119-259a79b27e12' // Riya
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

    if (!response.ok) return null;

    const pcmBuffer = Buffer.from(await response.arrayBuffer());
    const id = `${Date.now()}`;
    const tmpPcm = path.join(os.tmpdir(), `tts_${id}.pcm`);
    const tmpAlaw = path.join(os.tmpdir(), `tts_${id}.alaw`);

    fs.writeFileSync(tmpPcm, pcmBuffer);

    // Convert to A-LAW (Standard in many regions)
    spawnSync(ffmpeg.path, [
      '-f', 's16le', '-ar', '8000', '-ac', '1', '-i', tmpPcm,
      '-acodec', 'pcm_alaw', '-f', 'alaw', tmpAlaw, '-y'
    ]);

    const alawBuffer = fs.readFileSync(tmpAlaw);
    console.log('[TTS] A-LAW Buffer ready:', alawBuffer.length);

    try {
      fs.unlinkSync(tmpPcm);
      fs.unlinkSync(tmpAlaw);
    } catch (e) {}

    return alawBuffer;

  } catch (err) {
    console.error('[TTS Error]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
