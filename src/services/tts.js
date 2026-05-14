const Cartesia = require('@cartesia/cartesia-js').default;

// Initialize Cartesia client
const cartesia = new Cartesia({
  apiKey: process.env.CARTESIA_API_KEY || 'sk_car_kQjNE9rPCa4eaD8xzsMkPx',
});

/**
 * Generates ultra-low latency speech using Cartesia Sonic (Multilingual).
 * Using 'Sunil - Official Announcer' for a professional deep male voice.
 */
async function generateTTS(text) {
  try {
    console.log('[Cartesia TTS] Generating via Sunil (Official Announcer)...');

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
          id: 'be79f378-47fe-4f9c-b92b-f02cefa62ccf' // Sunil - Official Announcer
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
