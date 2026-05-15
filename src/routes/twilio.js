const express = require('express');
const router = express.Router();

router.post('/voice', async (req, res) => {
  const customerId = req.query.customer_id;
  console.log(`[Twilio Voice] Routing call to WebSocket for customer: ${customerId}`);
  
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://aiagent-production-6d4b.up.railway.app/voicelink/ws?customer_id=${customerId}"/>
  </Connect>
</Response>`);
});

router.post('/status', async (req, res) => {
  console.log(`[Twilio Status] Call Status: ${req.body.CallStatus}`);
  res.sendStatus(200);
});

module.exports = router;
