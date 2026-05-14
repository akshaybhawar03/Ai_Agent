const { spawnSync } = require('child_process');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

const filePath = 'c:\\Users\\AKSHAY BHAWAR\\OneDrive\\Desktop\\CollectAi\\backend\\temp_audio\\WhatsApp Audio 2026-05-14 at 7.32.14 PM.aac';

console.log('Analyzing:', filePath);
const result = spawnSync(ffmpeg.path, [
  '-i', filePath,
  '-af', 'volumedetect',
  '-f', 'null',
  '-'
], { stdio: 'pipe' });

console.log(result.stderr.toString());
