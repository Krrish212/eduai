require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const { connect } = require('./config/db');
const { coursesRouter, chatRouter } = require('./routes/courses');

const app = express();

// ─── SECURITY ────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:'],
    }
  }
}));

const origin = process.env.SITE_URL || 'http://localhost:3000';
app.use(cors({ origin, credentials: true }));

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
app.use('/api/queue/generate', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many AI generation requests. Limit: 10/min.' }
}));
app.use('/api/chat', rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many chat requests.' }
}));
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'Rate limit exceeded.' }
}));

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── STATIC FRONTEND ─────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use('/api/courses',         coursesRouter);
app.use('/api/chat',            chatRouter);
app.use('/api/dashboard',       require('./routes/dashboard'));
app.use('/api/students',        require('./routes/students'));
app.use('/api/submissions',     require('./routes/submissions'));
app.use('/api/misconceptions',  require('./routes/misconceptions'));
app.use('/api/interventions',   require('./routes/interventions'));
app.use('/api/queue',           require('./routes/queue'));
app.use('/api/analytics',       require('./routes/analytics'));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  env:    process.env.NODE_ENV,
  time:   new Date().toISOString(),
}));

// ─── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Route not found' });
  }
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Error]', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// ─── START ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  await connect();

  // Start cron jobs AFTER DB is connected
  require('./services/cronJobs');

  app.listen(PORT, () => {
    console.log(`\n[EduAI] Server running on port ${PORT}`);
    console.log(`[EduAI] Environment: ${process.env.NODE_ENV}`);
    console.log(`[EduAI] Dashboard: http://localhost:${PORT}\n`);
  });
})();

module.exports = app;
