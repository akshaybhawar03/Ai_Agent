/**
 * Deepgram STT service
 * Creates a live transcription WebSocket connection
 */

const WebSocket = require('ws');

function createLiveTranscription(apiKey, options = {}) {
  const key = apiKey || process.env.DEEPGRAM_API_KEY;

  const dgUrl = `wss://api.deepgram.com/v1/listen?` +
    `model=${options.model || 'nova-2'}` +
    `&language=${options.language || 'hi'}` +
    `&punctuate=true` +
    `&interim_results=true` +
    `&endpointing=300` +
    `&encoding=${options.encoding || 'mulaw'}` +
    `&sample_rate=${options.sampleRate || 8000}` +
    `&channels=1`;

  const ws = new WebSocket(dgUrl, {
    headers: { 'Authorization': `Token ${key}` }
  });

  return ws;
}

/**
 * Transcribe a pre-recorded audio file
 */
async function transcribeFile(audioUrl, apiKey) {
  const key = apiKey || process.env.DEEPGRAM_API_KEY;

  const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=hi&punctuate=true', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url: audioUrl })
  });

  if (!response.ok) throw new Error('Deepgram transcription failed');
  const data = await response.json();
  return data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
}

module.exports = { createLiveTranscription, transcribeFile };
