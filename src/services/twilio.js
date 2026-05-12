const twilio = require('twilio');

/**
 * Get a Twilio client for a specific business or use defaults
 */
function getTwilioClient(accountSid, authToken) {
  const sid = accountSid || process.env.TWILIO_ACCOUNT_SID;
  const token = authToken || process.env.TWILIO_AUTH_TOKEN;
  return twilio(sid, token);
}

/**
 * Initiate an outbound call
 */
async function makeCall({ to, from, webhookUrl, statusCallback, accountSid, authToken }) {
  const client = getTwilioClient(accountSid, authToken);
  const fromNumber = from || process.env.TWILIO_PHONE_NUMBER;

  const call = await client.calls.create({
    to,
    from: fromNumber,
    url: webhookUrl,
    statusCallback,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    statusCallbackMethod: 'POST',
    record: true,
    recordingStatusCallback: `${process.env.WEBHOOK_BASE_URL}/webhook/twilio/recording`,
    recordingStatusCallbackMethod: 'POST',
    machineDetection: 'Enable',
    timeout: 30
  });

  return call;
}

/**
 * Generate TwiML for the AI conversation
 */
function generateTwiML(message, gatherUrl) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  if (message) {
    response.say({ voice: 'Polly.Aditi', language: 'hi-IN' }, message);
  }

  if (gatherUrl) {
    const gather = response.gather({
      input: 'speech',
      language: 'hi-IN',
      speechTimeout: 'auto',
      action: gatherUrl,
      method: 'POST',
      timeout: 5
    });
  }

  return response.toString();
}

module.exports = { getTwilioClient, makeCall, generateTwiML };
