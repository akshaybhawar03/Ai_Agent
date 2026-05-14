require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');

// Routes
const authRoutes = require('./routes/auth');
const businessRoutes = require('./routes/business');
const agentRoutes = require('./routes/agent');
const customerRoutes = require('./routes/customers');
const callRoutes = require('./routes/calls');
const statsRoutes = require('./routes/stats');
const webhookRoutes = require('./routes/webhooks');
const { router: voicelinkRouter, setupVoiceLinkWebSocket } = require('./routes/voicelink');

// Middleware
const authMiddleware = require('./middleware/auth');

// Jobs
const { initScheduler } = require('./jobs/scheduler');

const app = express();
const server = http.createServer(app);

// WebSocket
const wss = new WebSocketServer({ server, path: '/ws' });
const wsClients = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const businessId = url.searchParams.get('businessId');
  if (businessId) {
    wsClients.set(businessId, ws);
    ws.on('close', () => wsClients.delete(businessId));
  }
});

// Make WS broadcast available globally
app.set('wsClients', wsClients);

// VoiceLink WebSocket
const voicelinkWss = new WebSocketServer({ server, path: '/voicelink/ws' });

voicelinkWss.on('connection', (ws, req) => {
  console.log(`[VoiceLink WS] New Connection Attempt from ${req.socket.remoteAddress} to ${req.url}`);
});

voicelinkWss.on('error', (err) => {
  console.error('[VoiceLink WSS Server Error]', err);
});

setupVoiceLinkWebSocket(voicelinkWss);

// Middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Public routes
app.use('/auth', authRoutes);
app.use('/webhook/twilio', webhookRoutes);
app.use('/voicelink', voicelinkRouter);

// Protected routes
app.use('/api/business', authMiddleware, businessRoutes);
app.use('/api/agent', authMiddleware, agentRoutes);
app.use('/api/customers', authMiddleware, customerRoutes);
app.use('/api/calls', authMiddleware, callRoutes);
app.use('/api/stats', authMiddleware, statsRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`CollectAI Backend running on port ${PORT}`);
  console.log(`[AI Provider] ${process.env.GROQ_API_KEY ? 'Groq (Free - Llama 3.3)' : 'OpenAI'}`);
  console.log(`[Webhook URL] ${process.env.WEBHOOK_BASE_URL}`);
  
  console.log(`[TTS Provider] OpenAI (tts-1)`);

  initScheduler();
});

module.exports = { app, server };
