const fetch = require('node-fetch');

async function getVoices() {
  const apiKey = 'sk_car_kQjNE9rPCa4eaD8xzsMkPx';
  try {
    const response = await fetch('https://api.cartesia.ai/voices', {
      headers: {
        'X-API-Key': apiKey,
        'Cartesia-Version': '2024-06-10'
      }
    });
    const voices = await response.json();
    console.log(JSON.stringify(voices, null, 2));
  } catch (err) {
    console.error(err);
  }
}

getVoices();
