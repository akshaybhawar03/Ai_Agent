// VoiceLink Service - Handles authentication and outbound call triggering
// Using the correct Add Lead endpoint for outbound calls

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
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        username: process.env.VOICELINK_USERNAME,
        password: process.env.VOICELINK_PASSWORD
      })
    });

    const data = await response.json();
    const token = data.token || 
                  (data.data && data.data.token) || 
                  (data.data && data.data.access_token) || 
                  data.access_token;

    if (response.ok && token) {
      console.log('[VoiceLink] Login successful, token received');
      return token;
    }
    console.error(`[VoiceLink] Login Failed (Status ${response.status}):`, data.message || 'No token found');
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

    // Remove + from phone numbers if present (VoiceLink often expects raw digits)
    const cleanTo = customer.phone.replace(/\D/g, '');
    const cleanFrom = (process.env.VOICELINK_DID_NUMBER || '').replace(/\D/g, '');

    console.log(`[VoiceLink] Triggering outbound lead to ${cleanTo} from DID ${cleanFrom}`);

    const response = await fetch('https://app.voicelink.co.in/api/v1/add_lead', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        did_number: cleanFrom,
        customer_number: cleanTo,
        country_code: "91",
        websocket_url: `wss://aiagent-production-6d4b.up.railway.app/voicelink/ws`,
        custom_parameters: JSON.stringify({ 
          customer_id: customer.id,
          overrideWsUrl: `wss://aiagent-production-6d4b.up.railway.app/voicelink/ws?customer_id=${customer.id}`
        })
      })
    });

    const responseText = await response.text();
    console.log(`[VoiceLink] Add Lead Response (Status ${response.status}):`, responseText.substring(0, 200));

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`VoiceLink returned non-JSON. Status: ${response.status}. Body: ${responseText.substring(0, 50)}`);
    }

    if (response.status >= 400 || (data.status === false)) {
       throw new Error(data.message || `VoiceLink API error (Status ${response.status})`);
    }
    return { id: data.id || Date.now().toString(), ...data };
  } catch (err) {
    throw err;
  }
}

module.exports = { triggerVoiceLinkCall };
