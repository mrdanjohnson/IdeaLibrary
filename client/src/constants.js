export const STATUSES = {
  new: { label: 'New', color: 'var(--status-new)', blurb: 'Fresh in the library' },
  under_review: { label: 'Under Review', color: 'var(--status-review)', blurb: 'Leadership is talking it through' },
  scheduled: { label: 'Scheduled', color: 'var(--status-scheduled)', blurb: 'It’s on the calendar' },
  in_progress: { label: 'In Progress', color: 'var(--status-progress)', blurb: 'Being built right now' },
  done: { label: 'Done', color: 'var(--status-done)', blurb: 'Brought to life' },
  not_now: { label: 'Not Right Now', color: 'var(--status-notnow)', blurb: 'A good idea for another season' },
};

export const STATUS_ORDER = ['new', 'under_review', 'scheduled', 'in_progress', 'done', 'not_now'];

export const RATINGS = {
  1: 'Ah, whatever',
  2: 'Could be cool',
  3: 'I’d love to see it',
  4: 'Can’t stop thinking about it',
  5: 'Word of the Lord',
};

export const NOT_NOW_REASONS = {
  timing: 'Timing — the season or calendar isn’t right yet',
  budget: 'Budget — resources aren’t available right now',
  capacity: 'Capacity — we don’t have the people to do it well yet',
  vision: 'Vision — doesn’t fit our current focus',
  exists: 'Already happening — something similar is in place',
  details: 'Needs more detail — help us understand it better',
  other: 'Other',
};

export const SORTS = {
  trending: 'Trending',
  top: 'Most votes',
  new: 'Newest',
  passion: 'Most passionate',
  discussed: 'Most discussed',
};

export const REPORT_REASONS = ['Spam', 'Inappropriate', 'Duplicate', 'Other'];

/** "1:02:15" | "2:10" | "95" -> seconds, or null if it can't be read. */
export function parseTime(input) {
  const s = String(input).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const hms = s.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i);
  if (hms && (hms[1] || hms[2] || hms[3])) return (+hms[1] || 0) * 3600 + (+hms[2] || 0) * 60 + (+hms[3] || 0);
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
}

export function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function youtubeId(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else id = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1];
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function timeAgo(sqlDate) {
  const then = Date.parse(sqlDate.replace(' ', 'T') + 'Z');
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 60) return 'just now';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [name, s] of units) {
    const n = Math.floor(sec / s);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
