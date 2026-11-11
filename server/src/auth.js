import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 30;
export const COOKIE = 'il_sid';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [, saltB64, keyB64] = stored.split('$');
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha(token),
    userId,
    expires.toISOString(),
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    expires,
  });
}

export function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
  res.clearCookie(COOKIE);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const userBySession = db.prepare(`
  SELECT u.id, u.email, u.name, u.role FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ? AND s.expires_at > ?
`);
const leadCats = db.prepare('SELECT category_id FROM category_leads WHERE user_id = ?');

/** Attaches req.user (or null) on every request. */
export function loadUser(req, _res, next) {
  const token = readCookie(req, COOKIE);
  req.user = null;
  if (token) {
    const user = userBySession.get(sha(token), new Date().toISOString());
    if (user) {
      user.leadCategoryIds = leadCats.all(user.id).map((r) => r.category_id);
      req.user = user;
    }
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  next();
}

/** Admins manage everything; category leads manage ideas in their categories. */
export function canManageIdea(user, idea) {
  if (!user) return false;
  return user.role === 'admin' || user.leadCategoryIds.includes(idea.category_id);
}

export function isStaff(user) {
  return !!user && (user.role === 'admin' || user.leadCategoryIds.length > 0);
}

// Light brute-force protection for login, kept in memory.
const attempts = new Map();
export function loginThrottle(key) {
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, first: now };
  if (now - entry.first > 15 * 60e3) {
    entry.count = 0;
    entry.first = now;
  }
  entry.count++;
  attempts.set(key, entry);
  return entry.count > 10;
}
export function clearThrottle(key) {
  attempts.delete(key);
}

setInterval(
  () => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()),
  6 * 3600e3,
).unref();
