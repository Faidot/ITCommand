'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');

const config = require('./config/configManager');
const logger = require('./lib/logger');

const authRoutes = require('./routes/auth');
const ssoRoutes = require('./routes/sso');
const folderRoutes = require('./routes/folders');
const messageRoutes = require('./routes/messages');
const composeRoutes = require('./routes/compose');
const attachmentRoutes = require('./routes/attachments');
const adminRoutes = require('./routes/admin');

const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

/* ---------------------------------------------------------------- */
/* First-run admin bootstrap                                        */
/* ---------------------------------------------------------------- */
async function bootstrapAdmin() {
  const sec = config.getSection('security');
  if (!sec.adminPassword) {
    const pw = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(pw, 10);
    config.update('security', { adminPassword: hash });
    logger.warn(
      `Admin password bootstrapped. Username "${sec.adminUsername}", password "${pw}". ` +
        'Change it from the admin Security page.'
    );
  }
}

/* ---------------------------------------------------------------- */
/* Session store (Redis with in-memory fallback)                    */
/* ---------------------------------------------------------------- */
async function buildSessionStore() {
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('REDIS_URL not set — using in-memory session store (dev only).');
    return undefined;
  }
  try {
    const { createClient } = require('redis');
    const connectRedis = require('connect-redis');
    const RedisStore = connectRedis.RedisStore || connectRedis.default || connectRedis;

    const client = createClient({ url, socket: { reconnectStrategy: (r) => Math.min(r * 200, 3000) } });
    client.on('error', (err) => logger.warn('Redis error', { error: err.message }));

    // Fail fast if Redis isn't reachable so we can fall back cleanly.
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connect timeout')), 3000)),
    ]);

    logger.info('Connected to Redis session store');
    return new RedisStore({ client, prefix: 'teramailer:sess:' });
  } catch (err) {
    logger.warn(`Redis unavailable (${err.message}) — falling back to in-memory session store.`);
    return undefined;
  }
}

/* ---------------------------------------------------------------- */
/* App                                                              */
/* ---------------------------------------------------------------- */
async function createApp() {
  await bootstrapAdmin();
  const store = await buildSessionStore();

  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Email HTML can reference remote images; relax CSP for that. Tighten
      // per your threat model in production.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: origins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-csrf-token'],
    })
  );

  app.use(morgan('combined', { stream: logger.stream }));
  // The raw body is kept for service-request signing. Re-serialising the
  // parsed object would break the signature the moment key order differed.
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf-8');
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  const ttl = (config.getSection('security').sessionTTL || 86400) * 1000;
  // Cookie security: COOKIE_SECURE explicitly wins ('true'/'false'); otherwise
  // default to secure in production. Secure cookies require HTTPS, so when
  // serving over plain http (e.g. on a trusted LAN) set COOKIE_SECURE=false.
  const cookieSecure =
    process.env.COOKIE_SECURE === 'true'
      ? true
      : process.env.COOKIE_SECURE === 'false'
      ? false
      : isProd;
  // SameSite=strict needs a secure cookie to be useful; fall back to lax when
  // not secure so the session cookie is still sent over http on a LAN.
  const sameSite = cookieSecure ? 'strict' : 'lax';
  app.use(
    session({
      name: 'teramailer.sid',
      store, // undefined => default MemoryStore
      secret: process.env.SESSION_SECRET || 'teramailer-dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: cookieSecure,
        sameSite,
        maxAge: ttl,
      },
    })
  );

  app.get('/api/health', (req, res) => res.json({ ok: true, name: config.getSection('app').name }));

  app.use('/api/auth/sso', ssoRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/folders', folderRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/send', composeRoutes);
  app.use('/api/attachments', attachmentRoutes);
  app.use('/api/admin', adminRoutes);

  /* ---- Production static serving of the two SPAs ---- */
  if (isProd) {
    const adminDist = path.join(__dirname, '..', '..', 'admin', 'dist');
    const webDist = path.join(__dirname, '..', '..', 'frontend', 'dist');

    // Cache hashed assets forever, but never cache index.html so the browser
    // always picks up the latest asset references after a rebuild.
    const staticOpts = {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    };
    const sendIndex = (dir) => (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dir, 'index.html'));
    };

    if (fs.existsSync(adminDist)) {
      app.use('/admin', express.static(adminDist, staticOpts));
      app.get('/admin/*', sendIndex(adminDist));
    }
    if (fs.existsSync(webDist)) {
      app.use(express.static(webDist, staticOpts));
      app.get(/^\/(?!api|admin).*/, sendIndex(webDist));
    }
  }

  // 404 for unmatched API routes.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    if (res.headersSent) return;
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

createApp()
  .then((app) => {
    app.listen(PORT, () => {
      logger.info(`TeraMailer backend listening on http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
    });
  })
  .catch((err) => {
    logger.error('Failed to start server', { error: err.message, stack: err.stack });
    process.exit(1);
  });

module.exports = { createApp };
