const Cartesia = require('@cartesia/cartesia-js').default;

// Initialize Cartesia client
const cartesia = new Cartesia({
  apiKey: process.env.CARTESIA_API_KEY || 'sk_car_kQjNE9rPCa4eaD8xzsMkPx',
});

/**
 * Generates ultra-low latency speech using Cartesia Sonic (Multilingual).
 * Returns mulaw audio at 8kHz directly - perfect for VoiceLink.
 */
async function generateTTS(text) {
  try {
    console.log('[Cartesia TTS] Generating via Sonic (Hindi Male)...');

    // Cartesia supports direct mulaw/8000 output
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
          id: '74668b55-aaa7-4493-9c86-89d136854e7d' // Ayush (Hindi Male)
        },
        output_format: {
          container: 'raw',
          encoding: 'pcm_mulaw',
          sample_rate: 8000
        },
        language: 'hi'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Cartesia Error]', response.status, errText);
      return null;
    }

    // Response is raw binary mulaw
    const arrayBuffer = await response.arrayBuffer();
    const mulawBuffer = Buffer.from(arrayBuffer);
    
    console.log('[Cartesia TTS] Mulaw success! size:', mulawBuffer.length, 'bytes');
    return mulawBuffer;

  } catch (err) {
    console.error('[Cartesia Global Error]', err.message);
    return null;
  }
}

module.exports = { generateTTS };
