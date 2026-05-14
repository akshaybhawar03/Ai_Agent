const gtts = require('node-gtts');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

/**
 * Generates speech using Google Translate TTS (free) and converts to telephony mulaw.
 */
async function generateTTS(text) {
  return new Promise((resolve) => {
    try {
      const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const tmpMp3 = path.join(os.tmpdir(), `tts_${requestId}.mp3`);
      const tmpRaw = path.join(os.tmpdir(), `tts_${requestId}.raw`);
      
      // Google TTS Hindi instance
      const ttsInstance = gtts('hi');
      
      console.log('[TTS] Generating via Google TTS...');
      
      ttsInstance.save(tmpMp3, text, (err) => {
        if (err) {
          console.error('[TTS] Google TTS Save Error:', err.message);
          return resolve(null);
        }
        
        try {
          if (!fs.existsSync(tmpMp3)) {
            console.error('[TTS] MP3 file not found after save');
            return resolve(null);
          }

          const fileSize = fs.statSync(tmpMp3).size;
          console.log('[TTS] MP3 saved, size:', fileSize, 'bytes');
          
          if (fileSize < 50) {
            console.error('[TTS] MP3 too small, likely an error response');
            return resolve(null);
          }
          
          // Convert to mulaw 8khz for telephony
          try {
            execSync(
              `"${ffmpeg.path}" -i "${tmpMp3}" -acodec pcm_mulaw -ar 8000 -ac 1 -f mulaw "${tmpRaw}" -y`,
              { stdio: 'pipe' }
            );
          } catch (convErr) {
            console.error('[TTS] FFmpeg conversion failed:', convErr.stderr?.toString() || convErr.message);
            throw convErr;
          }
          
          const mulawBuffer = fs.readFileSync(tmpRaw);
          console.log('[TTS] Mulaw success! size:', mulawBuffer.length, 'bytes');
          
          // Cleanup
          try { fs.unlinkSync(tmpMp3); } catch {}
          try { fs.unlinkSync(tmpRaw); } catch {}
          
          resolve(mulawBuffer);
        } catch (innerErr) {
          console.error('[TTS] Error during processing:', innerErr.message);
          resolve(null);
        }
      });
    } catch (err) {
      console.error('[TTS Global Error]', err.message);
      resolve(null);
    }
  });
}

module.exports = { generateTTS };
