import { Router } from 'express';
import { db, transaction, p } from '../db.js';
import { requireUser, canManageIdea } from '../auth.js';
import { youtubeId, youtubeUrlAt, timestampFromUrl } from '../lib/youtube.js';
import { captureThumbnail, previewLink } from '../lib/thumbnails.js';
import { similar } from '../lib/similarity.js';
import { notify, ideaFollowers } from '../lib/notify.js';
import { STATUSES, NOT_NOW_REASONS, REPORT_REASONS } from '../lib/constants.js';
import { asanaSync, taskUrl } from '../lib/asana.js';

const r = Router();
const PAGE_SIZE = 24;

const BASE_SELECT = `
  SELECT i.*, c.name AS category_name, c.color AS category_color, u.name AS author_name,
    COALESCE((SELECT SUM(value) FROM votes v WHERE v.idea_id = i.id), 0) AS score,
    (SELECT COUNT(*) FROM votes v WHERE v.idea_id = i.id AND v.value = 1) AS upvotes,
    (SELECT COUNT(*) FROM votes v WHERE v.idea_id = i.id AND v.value = -1) AS downvotes,
    (SELECT COUNT(*) FROM comments m WHERE m.idea_id = i.id AND m.hidden = 0) AS comment_count,
    (SELECT value FROM votes v WHERE v.idea_id = i.id AND v.user_id = ?) AS my_vote
  FROM ideas i
  JOIN categories c ON c.id = i.category_id
  JOIN users u ON u.id = i.user_id`;

/** Shapes a DB row for the client, hiding anonymous authors from everyone but themselves + admins. */
function serialize(row, viewer) {
  const mine = viewer?.id === row.user_id;
  const revealAuthor = !row.anonymous || mine || viewer?.role === 'admin';
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    url: row.url,
    resolvedUrl: row.resolved_url,
    youtubeId: row.youtube_id,
    source: row.source,
    rating: row.rating,
    anonymous: !!row.anonymous,
    thumbnail: row.thumbnail ? `/thumbnails/${row.thumbnail}` : null,
    status: row.status,
    scheduledFor: row.scheduled_for,
    needsWhy: !!row.needs_why,
    hidden: !!row.hidden,
    mergedInto: row.merged_into,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    category: { id: row.category_id, name: row.category_name, color: row.category_color },
    author: revealAuthor ? { id: row.user_id, name: row.author_name } : null,
    score: row.score,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    commentCount: row.comment_count,
    myVote: row.my_vote ?? 0,
    isMine: mine,
    canEdit: mine || viewer?.role === 'admin',
    canManage: canManageIdea(viewer, row),
  };
}

function getIdeaRow(id, viewer) {
  return db.prepare(`${BASE_SELECT} WHERE i.id = ?`).get(viewer?.id ?? 0, id);
}

const ageHours = (iso) => (Date.now() - Date.parse(iso + 'Z')) / 3600e3;
const SORTS = {
  trending: (a, b) => hot(b) - hot(a),
  top: (a, b) => b.score - a.score || b.id - a.id,
  new: (a, b) => b.id - a.id,
  passion: (a, b) => b.rating - a.rating || b.score - a.score,
  discussed: (a, b) => b.comment_count - a.comment_count || b.id - a.id,
};
function hot(row) {
  return (row.score + row.comment_count * 0.5 + row.rating * 0.3 + 1) / Math.pow(ageHours(row.created_at) + 2, 1.15);
}

r.get('/ideas', (req, res) => {
  const viewer = req.user;
  const where = ['i.merged_into IS NULL'];
  const params = [viewer?.id ?? 0];
  if (!(viewer?.role === 'admin' && req.query.hidden === '1')) where.push('i.hidden = 0');
  else where.push('i.hidden = 1');
  if (req.query.category) {
    where.push('i.category_id = ?');
    params.push(Number(req.query.category));
  }
  if (req.query.status) {
    const list = String(req.query.status).split(',').filter((s) => s in STATUSES);
    if (list.length) {
      where.push(`i.status IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
  }
  if (req.query.mine === '1' && viewer) {
    where.push('i.user_id = ?');
    params.push(viewer.id);
  }
  if (req.query.q) {
    where.push('(i.title LIKE ? OR i.description LIKE ? OR i.source LIKE ?)');
    const like = `%${String(req.query.q).trim()}%`;
    params.push(like, like, like);
  }
  const rows = db.prepare(`${BASE_SELECT} WHERE ${where.join(' AND ')}`).all(...params);
  rows.sort(SORTS[req.query.sort] || SORTS.trending);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  res.json({
    ideas: slice.map((row) => serialize(row, viewer)),
    total: rows.length,
    page,
    pages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
  });
});

r.get('/ideas/similar', (req, res) => {
  const text = String(req.query.title || '');
  const exclude = Number(req.query.exclude) || 0;
  const candidates = db
    .prepare(
      `SELECT i.id, i.title, i.description, i.status, c.name AS category_name,
         COALESCE((SELECT SUM(value) FROM votes v WHERE v.idea_id = i.id), 0) AS score
       FROM ideas i JOIN categories c ON c.id = i.category_id
       WHERE i.hidden = 0 AND i.merged_into IS NULL AND i.id != ?`,
    )
    .all(exclude);
  res.json({
    ideas: similar(text, candidates).map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      category: c.category_name,
      score: c.score,
    })),
  });
});

r.get('/link-preview', requireUser, async (req, res) => {
  try {
    res.json(await previewLink(String(req.query.url || '')));
  } catch (err) {
    res.json({ title: null, image: null, error: err.message });
  }
});

r.get('/ideas/:id', (req, res) => {
  const viewer = req.user;
  const row = getIdeaRow(req.params.id, viewer);
  if (!row) return res.status(404).json({ error: 'Idea not found.' });
  if (row.hidden && !(viewer?.id === row.user_id || canManageIdea(viewer, row))) {
    return res.status(404).json({ error: 'Idea not found.' });
  }
  const idea = serialize(row, viewer);
  idea.timestamps = db
    .prepare('SELECT seconds, label FROM idea_timestamps WHERE idea_id = ? ORDER BY position')
    .all(row.id)
    .map((t) => ({ ...t, url: row.youtube_id ? youtubeUrlAt(row.youtube_id, t.seconds) : null }));

  const leadsFor = db.prepare('SELECT user_id FROM category_leads WHERE category_id = ?').all(row.category_id).map((x) => x.user_id);
  const staffIds = new Set([
    ...db.prepare("SELECT id FROM users WHERE role = 'admin'").all().map((x) => x.id),
    ...leadsFor,
  ]);
  const showHidden = canManageIdea(viewer, row);
  idea.comments = db
    .prepare(
      `SELECT m.*, u.name AS author_name FROM comments m JOIN users u ON u.id = m.user_id
       WHERE m.idea_id = ? ${showHidden ? '' : 'AND m.hidden = 0'} ORDER BY m.created_at, m.id`,
    )
    .all(row.id)
    .map((m) => ({
      id: m.id,
      body: m.body,
      official: !!m.is_official,
      hidden: !!m.hidden,
      createdAt: m.created_at,
      edited: m.updated_at !== m.created_at,
      author: {
        id: m.user_id,
        // Keep anonymous submitters anonymous in their own idea's thread too.
        name: row.anonymous && m.user_id === row.user_id && !idea.author ? 'Idea author' : m.author_name,
        staff: staffIds.has(m.user_id),
        isSubmitter: m.user_id === row.user_id,
      },
      canEdit: viewer?.id === m.user_id,
      canDelete: viewer?.id === m.user_id || showHidden,
    }));

  idea.timeline = db
    .prepare(
      `SELECT s.*, u.name AS by_name FROM status_changes s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.idea_id = ? ORDER BY s.created_at, s.id`,
    )
    .all(row.id)
    .map((s) => ({
      id: s.id,
      from: s.from_status,
      to: s.to_status,
      note: s.note,
      reason: s.reason_code ? { code: s.reason_code, label: NOT_NOW_REASONS[s.reason_code] } : null,
      revisitOn: s.revisit_on,
      scheduledFor: s.scheduled_for,
      createdAt: s.created_at,
      // The submission entry is "by" the author; respect anonymity there.
      by: s.from_status === null && row.anonymous && !idea.author ? null : s.by_name || s.actor_label,
    }));

  if (row.merged_into) {
    const target = db.prepare('SELECT id, title FROM ideas WHERE id = ?').get(row.merged_into);
    idea.mergedIntoIdea = target || null;
  }
  idea.mergedFrom = db.prepare('SELECT id, title FROM ideas WHERE merged_into = ?').all(row.id);
  if (idea.canManage) idea.asanaUrl = taskUrl(row.id);
  res.json({ idea });
});

function validateIdea(body, { partial = false } = {}) {
  const out = {};
  const errors = [];
  const has = (k) => body[k] !== undefined;
  if (!partial || has('title')) {
    out.title = String(body.title || '').trim();
    if (out.title.length < 3 || out.title.length > 120) errors.push('Give your idea a title (3–120 characters).');
  }
  if (!partial || has('description')) {
    out.description = String(body.description || '').trim();
    if (out.description.length < 10 || out.description.length > 5000)
      errors.push('Describe your idea in at least 10 characters.');
  }
  if (!partial || has('url')) {
    const url = String(body.url || '').trim();
    if (url) {
      try {
        const u = new URL(url);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
        out.url = u.toString();
      } catch {
        errors.push('That link doesn’t look like a valid web address.');
      }
    } else out.url = null;
  }
  if (!partial || has('categoryId')) {
    out.category_id = Number(body.categoryId);
    if (!db.prepare('SELECT 1 FROM categories WHERE id = ? AND archived = 0').get(out.category_id))
      errors.push('Pick a category.');
  }
  if (!partial || has('source')) out.source = String(body.source || '').trim().slice(0, 160);
  if (!partial || has('rating')) {
    out.rating = Number(body.rating);
    if (!Number.isInteger(out.rating) || out.rating < 1 || out.rating > 5) errors.push('Choose a passion rating from 1 to 5.');
  }
  if (!partial || has('anonymous')) out.anonymous = body.anonymous ? 1 : 0;
  if (!partial || has('timestamps')) {
    out.timestamps = (Array.isArray(body.timestamps) ? body.timestamps : [])
      .slice(0, 20)
      .map((t) => ({ seconds: Math.max(0, Math.floor(Number(t.seconds) || 0)), label: String(t.label || '').trim().slice(0, 120) }))
      .sort((a, b) => a.seconds - b.seconds);
  }
  return { out, errors };
}

/** Recomputes youtube_id + resolved_url (with &t=<seconds> for the first timestamp). */
function resolveUrl(url, timestamps) {
  if (!url) return { youtube_id: null, resolved_url: null };
  const yt = youtubeId(url);
  if (!yt) return { youtube_id: null, resolved_url: url };
  const start = timestamps?.length ? timestamps[0].seconds : timestampFromUrl(url);
  return { youtube_id: yt, resolved_url: youtubeUrlAt(yt, start) };
}

function saveTimestamps(ideaId, timestamps, isYoutube) {
  db.prepare('DELETE FROM idea_timestamps WHERE idea_id = ?').run(ideaId);
  if (!isYoutube) return;
  const ins = db.prepare('INSERT INTO idea_timestamps (idea_id, seconds, label, position) VALUES (?, ?, ?, ?)');
  timestamps.forEach((t, i) => ins.run(ideaId, t.seconds, t.label, i));
}

/** Grabs the thumbnail, waiting briefly so most submissions come back with one. */
async function refreshThumbnail(ideaId, url) {
  const job = (async () => {
    const name = url ? await captureThumbnail(url) : null;
    db.prepare('UPDATE ideas SET thumbnail = ? WHERE id = ?').run(name, ideaId);
  })();
  await Promise.race([job, new Promise((ok) => setTimeout(ok, 6000))]);
}

r.post('/ideas', requireUser, async (req, res) => {
  const { out, errors } = validateIdea(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const { youtube_id, resolved_url } = resolveUrl(out.url, out.timestamps);
  const id = transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO ideas (user_id, category_id, title, description, url, resolved_url, youtube_id, source, rating, anonymous)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(req.user.id, out.category_id, out.title, out.description, p(out.url), p(resolved_url), p(youtube_id), out.source, out.rating, out.anonymous);
    const ideaId = Number(lastInsertRowid);
    saveTimestamps(ideaId, out.timestamps, !!youtube_id);
    db.prepare(`INSERT INTO status_changes (idea_id, user_id, from_status, to_status, note) VALUES (?, ?, NULL, 'new', 'Idea submitted')`).run(ideaId, req.user.id);
    return ideaId;
  });
  const leads = db.prepare('SELECT user_id FROM category_leads WHERE category_id = ?').all(out.category_id).map((x) => x.user_id);
  notify(leads, { ideaId: id, actorId: req.user.id, type: 'new_idea', message: `New idea in your category: “${out.title}”` });
  if (out.url) await refreshThumbnail(id, out.url);
  res.status(201).json({ idea: serialize(getIdeaRow(id, req.user), req.user) });
});

r.patch('/ideas/:id', requireUser, async (req, res) => {
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Idea not found.' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'You can only edit your own ideas.' });
  const { out, errors } = validateIdea(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const url = 'url' in out ? out.url : row.url;
  const timestamps =
    out.timestamps ?? db.prepare('SELECT seconds, label FROM idea_timestamps WHERE idea_id = ? ORDER BY position').all(row.id);
  const { youtube_id, resolved_url } = resolveUrl(url, timestamps);
  transaction(() => {
    db.prepare(
      `UPDATE ideas SET title = ?, description = ?, url = ?, resolved_url = ?, youtube_id = ?, category_id = ?,
         source = ?, rating = ?, anonymous = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      out.title ?? row.title,
      out.description ?? row.description,
      p(url),
      p(resolved_url),
      p(youtube_id),
      out.category_id ?? row.category_id,
      out.source ?? row.source,
      out.rating ?? row.rating,
      out.anonymous ?? row.anonymous,
      row.id,
    );
    saveTimestamps(row.id, timestamps, !!youtube_id);
  });
  if (url !== row.url || (url && !row.thumbnail)) await refreshThumbnail(row.id, url);
  asanaSync.ideaChanged(row.id);
  res.json({ idea: serialize(getIdeaRow(row.id, req.user), req.user) });
});

r.delete('/ideas/:id', requireUser, (req, res) => {
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Idea not found.' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'You can only delete your own ideas.' });
  asanaSync.ideaDeleting(row.id);
  db.prepare('DELETE FROM ideas WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

r.post('/ideas/:id/thumbnail', requireUser, async (req, res) => {
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Idea not found.' });
  if (row.user_id !== req.user.id && !canManageIdea(req.user, row)) return res.status(403).json({ error: 'Not allowed.' });
  await refreshThumbnail(row.id, row.url);
  res.json({ idea: serialize(getIdeaRow(row.id, req.user), req.user) });
});

r.post('/ideas/:id/vote', requireUser, (req, res) => {
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!row || row.hidden || row.merged_into) return res.status(404).json({ error: 'Idea not found.' });
  if (row.user_id === req.user.id) return res.status(400).json({ error: 'You can’t vote on your own idea — but we know you love it.' });
  const value = Number(req.body.value);
  if (value === 0) db.prepare('DELETE FROM votes WHERE user_id = ? AND idea_id = ?').run(req.user.id, row.id);
  else if (value === 1 || value === -1)
    db.prepare(
      'INSERT INTO votes (user_id, idea_id, value) VALUES (?, ?, ?) ON CONFLICT(user_id, idea_id) DO UPDATE SET value = excluded.value',
    ).run(req.user.id, row.id, value);
  else return res.status(400).json({ error: 'Invalid vote.' });
  const fresh = getIdeaRow(row.id, req.user);
  res.json({ score: fresh.score, upvotes: fresh.upvotes, downvotes: fresh.downvotes, myVote: fresh.my_vote ?? 0 });
});

r.post('/ideas/:id/comments', requireUser, (req, res) => {
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!row || (row.hidden && !canManageIdea(req.user, row))) return res.status(404).json({ error: 'Idea not found.' });
  const body = String(req.body.body || '').trim();
  if (!body || body.length > 3000) return res.status(400).json({ error: 'Comments are 1–3000 characters.' });
  const official = canManageIdea(req.user, row) && req.body.official !== false ? 1 : 0;
  const followers = ideaFollowers(row.id);
  db.prepare('INSERT INTO comments (idea_id, user_id, body, is_official) VALUES (?, ?, ?, ?)').run(row.id, req.user.id, body, official);
  if (official) asanaSync.comment(row.id, `Leadership reply from ${req.user.name} in the Idea Library:\n\n${body}`);
  notify(followers, {
    ideaId: row.id,
    actorId: req.user.id,
    type: official ? 'official_reply' : 'comment',
    message: official
      ? `${req.user.name} (leadership) replied to “${row.title}”`
      : `${req.user.name} commented on “${row.title}”`,
  });
  res.status(201).json({ ok: true });
});

r.patch('/comments/:id', requireUser, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  if (c.user_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own comments.' });
  const body = String(req.body.body || '').trim();
  if (!body || body.length > 3000) return res.status(400).json({ error: 'Comments are 1–3000 characters.' });
  db.prepare("UPDATE comments SET body = ?, updated_at = datetime('now') WHERE id = ?").run(body, c.id);
  res.json({ ok: true });
});

r.delete('/comments/:id', requireUser, (req, res) => {
  const c = db.prepare('SELECT m.*, i.category_id FROM comments m JOIN ideas i ON i.id = m.idea_id WHERE m.id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  if (c.user_id !== req.user.id && !canManageIdea(req.user, c)) return res.status(403).json({ error: 'Not allowed.' });
  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ---- Leadership actions ----------------------------------------------------

r.post('/ideas/:id/status', requireUser, (req, res) => {
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Idea not found.' });
  if (!canManageIdea(req.user, row)) return res.status(403).json({ error: 'Only leadership can change status.' });
  const to = String(req.body.status || '');
  if (!(to in STATUSES)) return res.status(400).json({ error: 'Unknown status.' });
  const note = String(req.body.note || '').trim().slice(0, 2000);
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  let reason = null;
  let revisit = null;
  let scheduledFor = null;

  if (to === 'not_now') {
    reason = String(req.body.reasonCode || '');
    if (!(reason in NOT_NOW_REASONS)) return res.status(400).json({ error: 'Pick a reason so people understand why.' });
    if (note.length < 10) return res.status(400).json({ error: 'Share a sentence or two about why — it helps people keep dreaming.' });
    if (req.body.revisitOn) {
      if (!isDate(req.body.revisitOn)) return res.status(400).json({ error: 'Revisit date is invalid.' });
      revisit = req.body.revisitOn;
    }
  }
  if (to === 'scheduled') {
    if (!isDate(req.body.scheduledFor)) return res.status(400).json({ error: 'Pick the date it’s scheduled for.' });
    scheduledFor = req.body.scheduledFor;
  }
  if (to === 'in_progress' && isDate(req.body.scheduledFor)) scheduledFor = req.body.scheduledFor;
  if (to === 'in_progress' && !scheduledFor) scheduledFor = row.scheduled_for;

  transaction(() => {
    db.prepare(
      `INSERT INTO status_changes (idea_id, user_id, from_status, to_status, note, reason_code, revisit_on, scheduled_for)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, req.user.id, row.status, to, note, p(reason), p(revisit), p(scheduledFor));
    db.prepare("UPDATE ideas SET status = ?, scheduled_for = ?, needs_why = 0, updated_at = datetime('now') WHERE id = ?").run(to, p(scheduledFor), row.id);
  });
  asanaSync.ideaChanged(row.id);
  if (note || reason) {
    const why = reason ? `\nReason: ${NOT_NOW_REASONS[reason]}${revisit ? `\nRevisit around: ${revisit}` : ''}` : '';
    asanaSync.comment(row.id, `${req.user.name} set the status to ${STATUSES[to]} in the Idea Library.${why}${note ? `\n\n${note}` : ''}`);
  }

  const upvoters = db.prepare('SELECT user_id FROM votes WHERE idea_id = ? AND value = 1').all(row.id).map((x) => x.user_id);
  notify([...ideaFollowers(row.id), ...upvoters], {
    ideaId: row.id,
    actorId: req.user.id,
    type: 'status',
    message: `“${row.title}” is now ${STATUSES[to]}${scheduledFor ? ` (${scheduledFor})` : ''}`,
  });
  res.json({ ok: true });
});

r.post('/ideas/:id/merge', requireUser, (req, res) => {
  const from = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  const into = db.prepare('SELECT * FROM ideas WHERE id = ?').get(Number(req.body.intoId));
  if (!from || !into) return res.status(404).json({ error: 'Idea not found.' });
  if (from.id === into.id || into.merged_into) return res.status(400).json({ error: 'Pick a different, active idea.' });
  if (!canManageIdea(req.user, from) || !canManageIdea(req.user, into)) return res.status(403).json({ error: 'Not allowed.' });
  transaction(() => {
    // Carry votes across, skipping the target author's own vote and anyone who already voted there.
    db.prepare(
      `INSERT OR IGNORE INTO votes (user_id, idea_id, value, created_at)
       SELECT user_id, ?, value, created_at FROM votes WHERE idea_id = ? AND user_id != ?`,
    ).run(into.id, from.id, into.user_id);
    if (from.user_id !== into.user_id)
      db.prepare('INSERT OR IGNORE INTO votes (user_id, idea_id, value) VALUES (?, ?, 1)').run(from.user_id, into.id);
    db.prepare('UPDATE ideas SET merged_into = ?, updated_at = datetime(\'now\') WHERE id = ?').run(into.id, from.id);
    db.prepare('UPDATE ideas SET merged_into = ? WHERE merged_into = ?').run(into.id, from.id);
    db.prepare(
      `INSERT INTO status_changes (idea_id, user_id, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)`,
    ).run(from.id, req.user.id, from.status, from.status, `Combined with “${into.title}” so the conversation lives in one place.`);
  });
  notify([from.user_id], {
    ideaId: into.id,
    actorId: req.user.id,
    type: 'merged',
    message: `Your idea “${from.title}” was combined with “${into.title}” — your vote carried over.`,
  });
  asanaSync.ideaChanged(from.id);
  asanaSync.ideaChanged(into.id);
  res.json({ ok: true });
});

r.post('/ideas/:id/visibility', requireUser, (req, res) => {
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Idea not found.' });
  if (!canManageIdea(req.user, row)) return res.status(403).json({ error: 'Not allowed.' });
  db.prepare('UPDATE ideas SET hidden = ? WHERE id = ?').run(req.body.hidden ? 1 : 0, row.id);
  asanaSync.ideaChanged(row.id);
  res.json({ ok: true });
});

r.post('/comments/:id/visibility', requireUser, (req, res) => {
  const c = db.prepare('SELECT m.*, i.category_id FROM comments m JOIN ideas i ON i.id = m.idea_id WHERE m.id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  if (!canManageIdea(req.user, c)) return res.status(403).json({ error: 'Not allowed.' });
  db.prepare('UPDATE comments SET hidden = ? WHERE id = ?').run(req.body.hidden ? 1 : 0, c.id);
  res.json({ ok: true });
});

r.post('/reports', requireUser, (req, res) => {
  const type = req.body.targetType;
  const id = Number(req.body.targetId);
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  if (!['idea', 'comment'].includes(type) || !id) return res.status(400).json({ error: 'Invalid report.' });
  if (!reason) return res.status(400).json({ error: `Let us know why (${REPORT_REASONS.join(', ')}).` });
  const ideaId =
    type === 'idea' ? db.prepare('SELECT id FROM ideas WHERE id = ?').get(id)?.id : db.prepare('SELECT idea_id FROM comments WHERE id = ?').get(id)?.idea_id;
  if (!ideaId) return res.status(404).json({ error: 'Not found.' });
  db.prepare('INSERT INTO reports (target_type, target_id, idea_id, user_id, reason) VALUES (?, ?, ?, ?, ?)').run(type, id, ideaId, req.user.id, reason);
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all().map((x) => x.id);
  notify(admins, { ideaId, actorId: req.user.id, type: 'report', message: `A ${type} was reported: ${reason}` });
  res.status(201).json({ ok: true });
});

r.get('/meta', (_req, res) => {
  res.json({ statuses: STATUSES, notNowReasons: NOT_NOW_REASONS, reportReasons: REPORT_REASONS });
});

export default r;
