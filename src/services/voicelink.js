// VoiceLink Service - Handles authentication and outbound call triggering
// We use the native fetch available in Node 18+

async function ensureAuthenticated() {
  if (process.env.VOICELINK_API_KEY) return process.env.VOICELINK_API_KEY;

  try {
    if (!process.env.VOICELINK_USERNAME || !process.env.VOICELINK_PASSWORD) {
      console.error('[VoiceLink] Missing VOICELINK_USERNAME or VOICELINK_PASSWORD in environment variables');
      return null;
    }
    console.log(`[VoiceLink] Attempting login for user: ${process.env.VOICELINK_USERNAME}`);
    
    // Using global fetch (available in Node 22)
    const response = await fetch('https://app.voicelink.co.in/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.VOICELINK_USERNAME,
        password: process.env.VOICELINK_PASSWORD
      })
    });

    const data = await response.json();
    console.log('[VoiceLink] Login Response:', JSON.stringify(data));

    // Check for token in common places (including data.data.access_token)
    const token = data.token || 
                  (data.data && data.data.token) || 
                  (data.data && data.data.access_token) || 
                  data.access_token;

    if (response.ok && token) {
      console.log('[VoiceLink] Login successful, token received');
      return token;
    }
    console.error(`[VoiceLink] Login Failed (Status ${response.status}):`, data.message || 'No token found in response');
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

    console.log(`[VoiceLink] Triggering outbound call to ${customer.phone}`);

    const response = await fetch('https://app.voicelink.co.in/api/v1/voice/outbound', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        to: customer.phone,
        from: process.env.VOICELINK_DID_NUMBER,
        trunk_id: process.env.VOICELINK_TRUNK_ID,
        websocket_url: `${process.env.WEBHOOK_BASE_URL.replace('https', 'wss')}/voicelink/ws`
      })
    });

    const responseText = await response.text();
    console.log(`[VoiceLink] Call Response (Status ${response.status}):`, responseText.substring(0, 200));

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`VoiceLink returned non-JSON response. Status: ${response.status}. Body: ${responseText.substring(0, 100)}`);
    }

    if (response.status >= 400 || (!data.success && !data.id)) {
       throw new Error(data.message || `VoiceLink API error (Status ${response.status})`);
    }
    return data;
  } catch (err) {
    throw err;
  }
}

module.exports = { triggerVoiceLinkCall };
