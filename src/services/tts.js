const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

/**
 * Generates natural Hindi speech using Microsoft's Neural voices.
 * Converts it to mulaw 8kHz for telephony using a robust buffer-to-file pipeline.
 */
async function generateTTS(text) {
  try {
    const tts = new MsEdgeTTS();
    
    // Using SwaraNeural - One of the best natural Hindi voices available for free
    await tts.setMetadata('hi-IN-SwaraNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tmpMp3 = path.join(os.tmpdir(), `tts_${requestId}.mp3`);
    const tmpRaw = path.join(os.tmpdir(), `tts_${requestId}.raw`);

    console.log('[TTS] Generating Natural Hindi (Swara)...');

    // Step 1: Save MP3 to file safely
    const { audioFilePath } = await tts.toFile(tmpMp3, text);
    
    if (!fs.existsSync(audioFilePath)) {
      throw new Error('TTS MP3 file was not generated');
    }

    // Step 2: Convert MP3 to Mulaw 8kHz Mono
    // We use -q:a 9 for low bit rate telephony feel and -acodec pcm_mulaw for compatibility
    try {
      execSync(`"${ffmpeg.path}" -i "${audioFilePath}" -acodec pcm_mulaw -ar 8000 -ac 1 -f mulaw "${tmpRaw}" -y`, {
        stdio: 'pipe'
      });
    } catch (convErr) {
      console.error('[TTS] FFmpeg conversion failed:', convErr.stderr?.toString() || convErr.message);
      throw convErr;
    }

    const mulawBuffer = fs.readFileSync(tmpRaw);
    console.log('[TTS] Mulaw synthesis successful! size:', mulawBuffer.length, 'bytes');

    // Step 3: Cleanup
    try {
      if (fs.existsSync(tmpMp3)) fs.unlinkSync(tmpMp3);
      if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw);
    } catch (e) {}

    return mulawBuffer;

  } catch (err) {
    console.error('[TTS Global Error]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
