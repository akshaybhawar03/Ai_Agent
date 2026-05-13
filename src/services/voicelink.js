const fetch = require('node-fetch');
// Deployment Timestamp: 2026-05-13T20:05:00Z

async function ensureAuthenticated() {
  if (process.env.VOICELINK_API_KEY) return process.env.VOICELINK_API_KEY;

  try {
    if (!process.env.VOICELINK_USERNAME || !process.env.VOICELINK_PASSWORD) {
      console.error('[VoiceLink] Missing VOICELINK_USERNAME or VOICELINK_PASSWORD in environment variables');
      return null;
    }
    console.log(`[VoiceLink] Attempting login for user: ${process.env.VOICELINK_USERNAME}`);
    const response = await fetch('https://app.voicelink.co.in/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.VOICELINK_USERNAME,
        password: process.env.VOICELINK_PASSWORD
      })
    });

    const data = await response.json();
    if (response.ok && data.token) {
      console.log('[VoiceLink] Login successful, token received');
      return data.token;
    }
    console.error(`[VoiceLink] Login Failed (Status ${response.status}):`, data.message || JSON.stringify(data));
    return null;
  } catch (err) {
    console.error('[VoiceLink Service Auth Error]', err.message);
    return null;
  }
}

async function triggerVoiceLinkCall(customer, business) {
  try {
    const token = await ensureAuthenticated();
    if (!token) throw new Error('VoiceLink authentication failed');

    const response = await fetch('https://app.voicelink.co.in/api/v1/calls/outbound', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        to: customer.phone,
        from: process.env.VOICELINK_DID_NUMBER,
        trunk_id: process.env.VOICELINK_TRUNK_ID,
        websocket_url: `${process.env.WEBHOOK_BASE_URL.replace('https', 'wss')}/voicelink/ws`
      })
    });

    const data = await response.json();
    if (!data.success && !data.id) {
       throw new Error(data.message || 'VoiceLink API error');
    }
    return data;
  } catch (err) {
    throw err;
  }
}

module.exports = { triggerVoiceLinkCall };
