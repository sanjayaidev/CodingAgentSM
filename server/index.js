// index.js
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import dotenv from 'dotenv';

import agentRoutes from './routes/agent.js';
import authRoutes from './routes/auth.js';
import repoRoutes from './routes/repos.js';
import fileRoutes from './routes/files.js';
import collabRoutes, { initCollaboration } from './routes/collaboration.js';
import analysisRoutes from './routes/codeAnalysis.js';
import { securityMiddleware, auditLogger, monitorRepoAccess } from './middleware/security.js';
import { createLogger } from './utils/logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

const logger = createLogger('server');

// Initialize collaboration manager with Socket.IO
const { collaborationManager, workspaceManager } = initCollaboration(httpServer);

// Make managers available to routes
app.set('collaborationManager', collaborationManager);
app.set('workspaceManager', workspaceManager);

// Needed so `secure` cookies work correctly behind Railway's proxy
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Security middleware
app.use(securityMiddleware);

// Audit logging
app.use(auditLogger);

// Repository access monitoring
app.use(monitorRepoAccess);

app.use(session({
  name: 'coding_agent.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  // NOTE: this is the default in-memory store. It's fine for a single
  // Railway instance / low traffic, but sessions are lost on restart and
  // won't be shared across multiple instances. Swap in connect-redis or
  // connect-pg-simple if you need persistence or horizontal scaling.
}));

app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/agent', agentRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/repos', repoRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/collab', collabRoutes);
app.use('/api/analysis', analysisRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    models: 68,
    version: '2.0.0',
    features: {
      collaboration: true,
      codeAnalysis: true,
      securityEnhanced: true,
      realTimeEditing: true,
    }
  });
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Coding Agent v2.0 running on port ${PORT}`);
  console.log(`📡 Alibaba endpoint: ${process.env.ALIBABA_BASE_URL || 'using workspace ID'}`);
  console.log(`🤖 Models available: 68 working models`);
  console.log(`🔒 Security: Enhanced with helmet, rate limiting, audit logging`);
  console.log(`👥 Collaboration: Real-time editing enabled`);
  console.log(`📊 Code Analysis: Complexity, bugs, optimizations\n`);
  
  logger.info('Server started', { 
    port: PORT, 
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid 
  });
});

export { httpServer, app };
