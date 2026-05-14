const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpegPath = require('ffmpeg-static');

/**
 * Generates high-quality speech and converts it to telephony-compatible mulaw 8kHz.
 * Uses ffmpeg-static for portability.
 */
async function generateTTS(text) {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(
      'hi-IN-MadhurNeural',
      OUTPUT_FORMAT.AUDIO_16KHZ_32KBITRATE_MONO_MP3
    );

    const { audioStream } = await tts.toStream(text);
    const mp3Chunks = [];
    
    await new Promise((resolve, reject) => {
      audioStream.on('data', chunk => mp3Chunks.push(chunk));
      audioStream.on('end', resolve);
      audioStream.on('error', reject);
    });
    
    const mp3Buffer = Buffer.concat(mp3Chunks);
    
    // Temporary file paths
    const requestId = Date.now();
    const tmpMp3 = path.join(os.tmpdir(), `tts_${requestId}.mp3`);
    const tmpPcm = path.join(os.tmpdir(), `tts_${requestId}.raw`);
    
    fs.writeFileSync(tmpMp3, mp3Buffer);
    
    // Convert MP3 to PCMU (mulaw) 8khz mono using portable ffmpeg
    try {
      execSync(`"${ffmpegPath}" -i ${tmpMp3} -ar 8000 -ac 1 -f mulaw ${tmpPcm} -y 2>/dev/null`);
    } catch (e) {
      console.error('[TTS] Portable ffmpeg conversion failed:', e.message);
      throw e;
    }
    
    const pcmBuffer = fs.readFileSync(tmpPcm);
    
    // Cleanup
    try {
      fs.unlinkSync(tmpMp3);
      fs.unlinkSync(tmpPcm);
    } catch (e) {}
    
    console.log('[TTS] Converted to mulaw 8khz, size:', pcmBuffer.length, 'bytes');
    return pcmBuffer;
    
  } catch (err) {
    console.error('[TTS Error]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
