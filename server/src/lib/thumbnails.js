import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { THUMB_DIR } from '../db.js';
import { youtubeId } from './youtube.js';

const MAX_HTML = 1_500_000;
const MAX_IMAGE = 6_000_000;
const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (compatible; IdeaLibraryBot/1.0; link preview)';

/**
 * The server sits on the church LAN, so never let a submitted link make it
 * fetch something internal (router admin pages, the NAS itself, etc).
 */
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http(s) links are supported');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error('That address is not reachable from here');
  }
  return u;
}

/** fetch() that re-validates every redirect hop and caps the body size. */
async function safeFetch(raw, accept, maxBytes) {
  let url = raw;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': UA, accept },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) break;
      chunks.push(chunk);
    }
    return { res, url, body: Buffer.concat(chunks) };
  }
  throw new Error('Too many redirects');
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/gi, '/');
}

function parseMeta(html) {
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
    }
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content && !(key in meta)) meta[key] = attrs.content;
  }
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (title) meta._title = decodeEntities(title[1].trim());
  const icon = html.match(/<link\b[^>]*rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/i);
  if (icon) {
    const href = icon[0].match(/href=["']([^"']+)["']/i);
    if (href) meta._icon = decodeEntities(href[1]);
  }
  return meta;
}

/** Looks at a link and returns { title, image } without saving anything. */
export async function previewLink(raw) {
  const yt = youtubeId(raw);
  if (yt) {
    let title = null;
    try {
      const { body } = await safeFetch(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt}`)}`,
        'application/json',
        100_000,
      );
      title = JSON.parse(body.toString()).title;
    } catch {
      /* title is optional */
    }
    return { youtubeId: yt, title, image: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` };
  }
  const { body, url, res } = await safeFetch(raw, 'text/html,application/xhtml+xml', MAX_HTML);
  const type = res.headers.get('content-type') || '';
  if (type.startsWith('image/')) return { title: null, image: url };
  const meta = parseMeta(body.toString('utf8'));
  const img =
    meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] ||
    meta['twitter:image:src'] || meta.image || meta._icon;
  return {
    title: meta['og:title'] || meta['twitter:title'] || meta._title || null,
    image: img ? new URL(img, url).toString() : null,
  };
}

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };

/** Downloads the preview image into the data volume; returns the stored filename or null. */
export async function captureThumbnail(raw) {
  try {
    const { image } = await previewLink(raw);
    if (!image) return null;
    const { res, body } = await safeFetch(image, 'image/*', MAX_IMAGE);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!EXT[type] || body.length < 200 || body.length >= MAX_IMAGE) return null;
    const name = crypto.createHash('sha1').update(body).digest('hex').slice(0, 20) + EXT[type];
    await fs.writeFile(path.join(THUMB_DIR, name), body);
    return name;
  } catch (err) {
    console.warn(`[thumbnail] ${raw}: ${err.message}`);
    return null;
  }
}
