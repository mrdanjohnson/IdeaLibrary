import { Router } from 'express';
import { db } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  requireUser,
  loginThrottle,
  clearThrottle,
} from '../auth.js';

const r = Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, leadCategoryIds: u.leadCategoryIds || [] };
}

r.get('/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

r.post('/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Please enter your name.' });
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'That email doesn’t look right.' });
  if (password.length < 8) return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }
  // The very first account becomes an admin so the platform can be set up.
  const first = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  const role = first || ADMIN_EMAILS.includes(email) ? 'admin' : 'member';
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, await hashPassword(password), role);
  createSession(res, Number(lastInsertRowid));
  res.status(201).json({ user: { id: Number(lastInsertRowid), name, email, role, leadCategoryIds: [] } });
});

r.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const key = `${req.ip}|${email}`;
  if (loginThrottle(key)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  clearThrottle(key);
  createSession(res, user.id);
  const leadCategoryIds = db
    .prepare('SELECT category_id FROM category_leads WHERE user_id = ?')
    .all(user.id)
    .map((x) => x.category_id);
  res.json({ user: publicUser({ ...user, leadCategoryIds }) });
});

r.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

r.patch('/me', requireUser, async (req, res) => {
  const { name, currentPassword, newPassword } = req.body;
  if (name !== undefined) {
    const n = String(name).trim();
    if (n.length < 2 || n.length > 60) return res.status(400).json({ error: 'Please enter your name.' });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(n, req.user.id);
  }
  if (newPassword) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await verifyPassword(String(currentPassword || ''), row.password_hash))) {
      return res.status(400).json({ error: 'Your current password is incorrect.' });
    }
    if (String(newPassword).length < 8) return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(String(newPassword)), req.user.id);
  }
  const u = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser({ ...u, leadCategoryIds: req.user.leadCategoryIds }) });
});

export default r;
