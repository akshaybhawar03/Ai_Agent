const express = require('express');
const router = express.Router();

router.post('/voice', async (req, res) => {
  const customerId = req.query.customer_id;
  console.log(`[Twilio Voice] Routing call to WebSocket for customer: ${customerId}`);
  
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://aiagent-production-6d4b.up.railway.app/voicelink/ws">
      <Parameter name="customer_id" value="${customerId}"/>
    </Stream>
  </Connect>
</Response>`);
});

const { supabaseAdmin: supabase } = require('../services/supabase');

router.post('/status', async (req, res) => {
  const { 
    CallSid, CallStatus, CallDuration, 
    RecordingUrl, To 
  } = req.body;
  
  console.log('[Twilio Status]', CallStatus, 'Duration:', CallDuration, 'SID:', CallSid);
  
  // Explicit duration update
  if (CallDuration && parseInt(CallDuration) > 0) {
    await supabase.from('call_logs').update({ 
      duration: parseInt(CallDuration) 
    }).eq('twilio_call_sid', CallSid);
    console.log('[Duration Updated]', CallDuration, 'seconds');
  }
  
  if (CallStatus === 'completed' || CallStatus === 'busy' || 
      CallStatus === 'no-answer' || CallStatus === 'failed') {
    
    try {
      // Find call log by twilio_call_sid
      const { data: callLog } = await supabase
        .from('call_logs')
        .select('*, customers(*)')
        .eq('twilio_call_sid', CallSid)
        .single();

      if (callLog) {
        // Update call log with duration and recording
        await supabase.from('call_logs').update({
          duration: parseInt(CallDuration) || 0,
          status: 'completed',
          recording_url: RecordingUrl ? (RecordingUrl + '.mp3') : callLog.recording_url,
          outcome: CallStatus === 'completed' ? (callLog.outcome || 'promise_given') : 'no_answer'
        }).eq('twilio_call_sid', CallSid);

        // Update customer status and call count
        const customerId = callLog.customer_id;
        const { data: customer } = await supabase
          .from('customers')
          .select('*')
          .eq('id', customerId)
          .single();

        if (customer) {
          const newStatus = CallStatus !== 'completed' ? 'No Answer' : 
                    (callLog.outcome === 'paid' ? 'Paid' : 'Promise Given');
                    
          await supabase.from('customers').update({
            last_call_date: new Date().toISOString(),
            call_count_today: (customer.call_count_today || 0) + 1,
            total_calls: (customer.total_calls || 0) + 1,
            status: newStatus
          }).eq('id', customerId);
        }
      }
    } catch (err) {
      console.error('[Status Update Error]', err.message);
    }
  }
  
  res.sendStatus(200);
});

router.post('/recording', async (req, res) => {
  const { CallSid, RecordingUrl, RecordingDuration } = req.body;
  console.log('[Recording URL Received]', RecordingUrl);
  
  try {
    await supabase.from('call_logs').update({
      recording_url: RecordingUrl + '.mp3',
      duration: parseInt(RecordingDuration) || 0
    }).eq('twilio_call_sid', CallSid);
  } catch (err) {
    console.error('[Recording Update Error]', err.message);
  }
  
  res.sendStatus(200);
});

module.exports = router;
