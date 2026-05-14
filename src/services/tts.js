const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

async function generateTTS(text) {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(
      'hi-IN-SwaraNeural', // Swara is generally more stable
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
    
    const requestId = Date.now();
    const tmpMp3 = path.join(os.tmpdir(), `tts_${requestId}.mp3`);
    const tmpPcm = path.join(os.tmpdir(), `tts_${requestId}.raw`);
    
    fs.writeFileSync(tmpMp3, mp3Buffer);
    
    // Improved ffmpeg command with full error logging
    try {
      // Using -acodec pcm_mulaw specifically
      execSync(`"${ffmpeg.path}" -i ${tmpMp3} -acodec pcm_mulaw -ar 8000 -ac 1 -f mulaw ${tmpPcm} -y`);
    } catch (e) {
      console.error('[TTS] ffmpeg error details:', e.stderr?.toString() || e.message);
      throw e;
    }
    
    const pcmBuffer = fs.readFileSync(tmpPcm);
    
    try {
      fs.unlinkSync(tmpMp3);
      fs.unlinkSync(tmpPcm);
    } catch (e) {}
    
    console.log('[TTS] Success! Mulaw size:', pcmBuffer.length);
    return pcmBuffer;
    
  } catch (err) {
    console.error('[TTS Error]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
