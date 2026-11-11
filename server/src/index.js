import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { THUMB_DIR } from './db.js';
import { loadUser } from './auth.js';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import ideaRoutes from './routes/ideas.js';
import adminRoutes from './routes/admin.js';
import { startAsanaPolling } from './lib/asana.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const CLIENT_DIR = process.env.CLIENT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

// Requests from the NAS's own reverse proxy (e.g. ideas.newdaychurch.cc → :8088) arrive from a private
// Docker address, so trust those to report the visitor's real IP (used for login rate limiting).
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, uniquelocal');
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((_req, res, next) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  next();
});

// CSRF guard: state-changing API calls must be JSON, which browsers won't send cross-site without CORS.
app.use('/api', (req, res, next) => {
  // DELETE can't be sent cross-site without CORS at all, so it may come without a body.
  if (['POST', 'PATCH', 'PUT'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Expected JSON.' });
  }
  next();
});

app.use(loadUser);
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api', ideaRoutes);
app.use('/api', adminRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

app.use('/thumbnails', express.static(THUMB_DIR, { maxAge: '30d', immutable: true }));

if (fs.existsSync(CLIENT_DIR)) {
  app.use(express.static(CLIENT_DIR, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong on our end.' });
});

app.listen(PORT, () => {
  console.log(`Idea Library listening on http://0.0.0.0:${PORT}`);
  startAsanaPolling();
});
