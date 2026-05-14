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

// Initialize WebSocket Servers without attaching to HTTP server yet
const dashboardWss = new WebSocketServer({ noServer: true });
const voicelinkWss = new WebSocketServer({ noServer: true });

const wsClients = new Map();

// Dashboard WS Logic
dashboardWss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const businessId = url.searchParams.get('businessId');
  if (businessId) {
    console.log(`[Dashboard WS] Connected: ${businessId}`);
    wsClients.set(businessId, ws);
    ws.on('close', () => wsClients.delete(businessId));
  }
});

// VoiceLink WS Logic
setupVoiceLinkWebSocket(voicelinkWss);

// Master Upgrade Handler
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname.startsWith('/voicelink/ws')) {
    console.log(`[Upgrade] Routing to VoiceLink WS: ${pathname}`);
    voicelinkWss.handleUpgrade(request, socket, head, (ws) => {
      voicelinkWss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws') {
    console.log(`[Upgrade] Routing to Dashboard WS: ${pathname}`);
    dashboardWss.handleUpgrade(request, socket, head, (ws) => {
      dashboardWss.emit('connection', ws, request);
    });
  } else {
    console.log(`[Upgrade] Unknown path: ${pathname}. Closing.`);
    socket.destroy();
  }
});

// Make WS broadcast available globally
app.set('wsClients', wsClients);

// Middleware
app.use((req, res, next) => {
  if (!req.url.includes('/health')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
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
  console.log(`[Webhook URL] ${process.env.WEBHOOK_BASE_URL}`);
  
  // Check for ffmpeg
  const ffmpegPath = require('ffmpeg-static');
  const { execSync } = require('child_process');
  try {
    execSync(`"${ffmpegPath}" -version`);
    console.log('[ffmpeg] Available (Static) ✅');
  } catch (err) {
    console.warn('[ffmpeg] NOT available ❌ - Check ffmpeg-static installation');
  }

  initScheduler();
});

module.exports = { app, server };
