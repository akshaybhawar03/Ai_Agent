const fetch = require('node-fetch');

/**
 * Convert text to speech using Deepgram Aura TTS
 */
async function textToSpeech(text, apiKey) {
  const key = apiKey || process.env.DEEPGRAM_API_KEY;
  
  if (!key) {
    throw new Error('Deepgram API Key is missing');
  }

  // Using Aura - Stella (Female) or Asteria (Female) or Orion (Male)
  // Options: aura-stella-en, aura-asteria-en, aura-luna-en, aura-stella-en
  // For Hindi, we use the standard model as it supports multiple languages
  const model = 'aura-stella-en'; 
  const url = `https://api.deepgram.com/v1/speak?model=${model}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Deepgram TTS failed: ${response.status} - ${err}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { textToSpeech };
