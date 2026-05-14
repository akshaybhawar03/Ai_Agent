const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

/**
 * Generates high-quality speech and converts it to telephony-compatible mulaw 8kHz.
 * Uses toFile() for reliability and @ffmpeg-installer/ffmpeg for conversion.
 */
async function generateTTS(text, voice = 'hi-IN-MadhurNeural') {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    
    // Create temporary paths
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tmpMp3 = path.join(os.tmpdir(), `tts_${requestId}.mp3`);
    const tmpRaw = path.join(os.tmpdir(), `tts_${requestId}.raw`);
    
    // Save to file using toFile() method - MUCH more reliable than streams
    const { audioFilePath } = await tts.toFile(tmpMp3, text);
    
    if (!fs.existsSync(audioFilePath) || fs.statSync(audioFilePath).size === 0) {
      throw new Error('MP3 file was not created or is empty');
    }

    console.log('[TTS] MP3 saved to:', audioFilePath, 'size:', fs.statSync(audioFilePath).size, 'bytes');
    
    // Convert to mulaw using portable ffmpeg
    try {
      execSync(`"${ffmpeg.path}" -i "${audioFilePath}" -acodec pcm_mulaw -ar 8000 -ac 1 -f mulaw "${tmpRaw}" -y`, {
        stdio: 'pipe'
      });
    } catch (e) {
      console.error('[TTS] ffmpeg error details:', e.stderr?.toString() || e.message);
      throw e;
    }
    
    const mulawBuffer = fs.readFileSync(tmpRaw);
    
    // Cleanup
    try { fs.unlinkSync(audioFilePath); } catch {}
    try { fs.unlinkSync(tmpRaw); } catch {}
    
    console.log('[TTS] Success! Mulaw buffer size:', mulawBuffer.length, 'bytes');
    return mulawBuffer;
    
  } catch (err) {
    console.error('[TTS Error]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
