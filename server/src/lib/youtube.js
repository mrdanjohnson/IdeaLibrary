const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** Returns the 11-char video id for any common YouTube URL shape, else null. */
export function youtubeId(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!YT_HOSTS.has(u.hostname.toLowerCase())) return null;
  let id = null;
  if (u.hostname.endsWith('youtu.be')) id = u.pathname.split('/')[1];
  else if (u.pathname === '/watch') id = u.searchParams.get('v');
  else {
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
    if (m) id = m[1];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/**
 * Builds a canonical watch URL that starts at `seconds`.
 * Normalises youtu.be / shorts / embed links so the `&t=` suffix always works.
 */
export function youtubeUrlAt(id, seconds) {
  const base = `https://www.youtube.com/watch?v=${id}`;
  return seconds > 0 ? `${base}&t=${Math.floor(seconds)}` : base;
}

/** Pulls a t= / start= value out of the pasted URL (supports 90, 90s, 1m30s, 1h2m3s). */
export function timestampFromUrl(raw) {
  try {
    const u = new URL(raw);
    const t = u.searchParams.get('t') || u.searchParams.get('start');
    if (!t) return 0;
    if (/^\d+s?$/.test(t)) return parseInt(t, 10);
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m) return 0;
    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  } catch {
    return 0;
  }
}
