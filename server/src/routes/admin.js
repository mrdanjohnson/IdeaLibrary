import { Router } from 'express';
import { db, transaction } from '../db.js';
import { requireUser, requireAdmin, isStaff } from '../auth.js';
import { STATUSES, NOT_NOW_REASONS, RATING_LABELS } from '../lib/constants.js';
import {
  asanaSync, connect, disconnect, getConfig, getStatusInfo, hasToken, listProjects, setAppUrl, syncEverything, whoAmI,
  SECTION_NAMES, REASON_FIELD_NAME,
} from '../lib/asana.js';

const r = Router();

// ---- Notifications (every signed-in user) ----------------------------------

r.get('/notifications', requireUser, (req, res) => {
  const items = db
    .prepare(
      `SELECT n.id, n.idea_id, n.type, n.message, n.read_at, n.created_at
       FROM notifications n WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50`,
    )
    .all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
  res.json({ notifications: items, unread });
});

r.post('/notifications/read', requireUser, (req, res) => {
  if (Array.isArray(req.body.ids) && req.body.ids.length) {
    const ids = req.body.ids.map(Number).filter(Boolean);
    db.prepare(
      `UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    ).run(req.user.id, ...ids);
  } else {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
  }
  res.json({ ok: true });
});

// ---- Leadership dashboard ---------------------------------------------------

r.get('/admin/stats', requireUser, (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Leadership only.' });
  const live = 'hidden = 0 AND merged_into IS NULL';
  const totals = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM ideas WHERE ${live}) AS ideas,
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM votes) AS votes,
        (SELECT COUNT(*) FROM comments WHERE hidden = 0) AS comments,
        (SELECT ROUND(AVG(rating), 2) FROM ideas WHERE ${live}) AS avg_rating,
        (SELECT COUNT(*) FROM ideas WHERE ${live} AND status = 'new') AS awaiting,
        (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open_reports`,
    )
    .get();
  const byStatus = db.prepare(`SELECT status, COUNT(*) AS n FROM ideas WHERE ${live} GROUP BY status`).all();
  const byCategory = db
    .prepare(
      `SELECT c.id, c.name, c.color, COUNT(i.id) AS n, ROUND(AVG(i.rating), 1) AS avg_rating
       FROM categories c LEFT JOIN ideas i ON i.category_id = c.id AND i.${live.replace(' AND ', ' AND i.')}
       GROUP BY c.id ORDER BY n DESC, c.name`,
    )
    .all();
  const byMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS n FROM ideas
       WHERE created_at >= date('now', 'start of month', '-11 months') GROUP BY month ORDER BY month`,
    )
    .all();
  const byRating = db.prepare(`SELECT rating, COUNT(*) AS n FROM ideas WHERE ${live} GROUP BY rating`).all();
  const topIdeas = db
    .prepare(
      `SELECT i.id, i.title, i.status, i.rating, COALESCE(SUM(v.value), 0) AS score
       FROM ideas i LEFT JOIN votes v ON v.idea_id = i.id
       WHERE i.${live.replace(' AND ', ' AND i.')} AND i.status IN ('new', 'under_review')
       GROUP BY i.id ORDER BY score DESC, i.rating DESC LIMIT 8`,
    )
    .all();
  const revisits = db
    .prepare(
      `SELECT i.id, i.title, s.revisit_on FROM ideas i
       JOIN status_changes s ON s.id = (SELECT MAX(id) FROM status_changes WHERE idea_id = i.id)
       WHERE i.status = 'not_now' AND s.revisit_on IS NOT NULL AND i.${live.replace(' AND ', ' AND i.')}
       ORDER BY s.revisit_on LIMIT 8`,
    )
    .all();
  const needsWhy = db
    .prepare(`SELECT id, title, updated_at FROM ideas WHERE needs_why = 1 AND status = 'not_now' AND ${live} ORDER BY updated_at`)
    .all();
  res.json({ totals, byStatus, byCategory, byMonth, byRating, topIdeas, revisits, needsWhy, statuses: STATUSES });
});

r.get('/admin/users', requireAdmin, (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.created_at,
         (SELECT COUNT(*) FROM ideas WHERE user_id = u.id) AS idea_count,
         (SELECT GROUP_CONCAT(category_id) FROM category_leads WHERE user_id = u.id) AS lead_ids
       FROM users u ORDER BY u.name COLLATE NOCASE`,
    )
    .all()
    .map((u) => ({ ...u, leadCategoryIds: u.lead_ids ? u.lead_ids.split(',').map(Number) : [] }));
  res.json({ users });
});

r.patch('/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { role, leadCategoryIds } = req.body;
  if (role !== undefined) {
    if (!['member', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (user.role === 'admin' && role !== 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
      if (admins <= 1) return res.status(400).json({ error: 'There must be at least one admin.' });
    }
  }
  transaction(() => {
    if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    if (Array.isArray(leadCategoryIds)) {
      db.prepare('DELETE FROM category_leads WHERE user_id = ?').run(id);
      const ins = db.prepare('INSERT OR IGNORE INTO category_leads (user_id, category_id) SELECT ?, id FROM categories WHERE id = ?');
      leadCategoryIds.map(Number).forEach((cid) => ins.run(id, cid));
    }
  });
  res.json({ ok: true });
});

r.delete('/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You can’t remove your own account here.' });
  asanaSync.ideaDeleting(db.prepare('SELECT id FROM ideas WHERE user_id = ?').all(id).map((x) => x.id));
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

r.get('/admin/reports', requireAdmin, (req, res) => {
  const status = ['open', 'dismissed', 'actioned'].includes(req.query.status) ? req.query.status : 'open';
  const reports = db
    .prepare(
      `SELECT r.*, u.name AS reporter, i.title AS idea_title,
         CASE r.target_type WHEN 'comment' THEN (SELECT body FROM comments WHERE id = r.target_id)
                            ELSE (SELECT description FROM ideas WHERE id = r.target_id) END AS excerpt,
         CASE r.target_type WHEN 'comment' THEN (SELECT hidden FROM comments WHERE id = r.target_id)
                            ELSE (SELECT hidden FROM ideas WHERE id = r.target_id) END AS target_hidden
       FROM reports r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN ideas i ON i.id = r.idea_id
       WHERE r.status = ? ORDER BY r.id DESC LIMIT 100`,
    )
    .all(status);
  res.json({ reports });
});

r.post('/admin/reports/:id', requireAdmin, (req, res) => {
  const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!rep) return res.status(404).json({ error: 'Report not found.' });
  const action = req.body.action;
  if (!['dismiss', 'hide'].includes(action)) return res.status(400).json({ error: 'Invalid action.' });
  transaction(() => {
    if (action === 'hide') {
      const table = rep.target_type === 'idea' ? 'ideas' : 'comments';
      db.prepare(`UPDATE ${table} SET hidden = 1 WHERE id = ?`).run(rep.target_id);
    }
    // Resolve every open report on the same target at once.
    db.prepare("UPDATE reports SET status = ?, resolved_by = ? WHERE target_type = ? AND target_id = ? AND status = 'open'").run(
      action === 'hide' ? 'actioned' : 'dismissed',
      req.user.id,
      rep.target_type,
      rep.target_id,
    );
  });
  if (action === 'hide' && rep.target_type === 'idea') asanaSync.ideaChanged(rep.target_id);
  res.json({ ok: true });
});

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Guard against spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

r.get('/admin/export.csv', requireUser, (req, res) => {
  if (!isStaff(req.user)) return res.status(403).json({ error: 'Leadership only.' });
  const rows = db
    .prepare(
      `SELECT i.id, i.title, i.description, c.name AS category, i.status, i.scheduled_for, i.rating,
         CASE WHEN i.anonymous = 1 THEN 'Anonymous' ELSE u.name END AS author,
         i.source, COALESCE(i.resolved_url, i.url) AS link,
         COALESCE((SELECT SUM(value) FROM votes WHERE idea_id = i.id), 0) AS score,
         (SELECT COUNT(*) FROM comments WHERE idea_id = i.id AND hidden = 0) AS comments,
         (SELECT reason_code FROM status_changes WHERE idea_id = i.id ORDER BY id DESC LIMIT 1) AS reason_code,
         i.created_at
       FROM ideas i JOIN categories c ON c.id = i.category_id JOIN users u ON u.id = i.user_id
       WHERE i.merged_into IS NULL AND i.hidden = 0 ORDER BY i.id`,
    )
    .all();
  const header = ['ID', 'Title', 'Description', 'Category', 'Status', 'Scheduled For', 'Passion', 'Passion Label', 'Submitted By', 'Source', 'Link', 'Score', 'Comments', 'Not Now Reason', 'Submitted'];
  const lines = [header.map(csvCell).join(',')];
  for (const r0 of rows) {
    lines.push(
      [
        r0.id, r0.title, r0.description, r0.category, STATUSES[r0.status], r0.scheduled_for, r0.rating,
        RATING_LABELS[r0.rating], r0.author, r0.source, r0.link, r0.score, r0.comments,
        r0.status === 'not_now' && r0.reason_code ? NOT_NOW_REASONS[r0.reason_code] : '', r0.created_at,
      ].map(csvCell).join(','),
    );
  }
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="idea-library-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

// ---- Asana ------------------------------------------------------------------

r.get('/admin/asana', requireAdmin, async (_req, res) => {
  const config = getConfig();
  const out = {
    tokenPresent: hasToken(),
    config,
    status: getStatusInfo(),
    linked: db.prepare('SELECT COUNT(*) AS n FROM asana_tasks').get().n,
    eligible: db.prepare("SELECT COUNT(*) AS n FROM ideas WHERE status != 'new' AND hidden = 0 AND merged_into IS NULL").get().n,
    sectionNames: SECTION_NAMES,
    reasonFieldName: REASON_FIELD_NAME,
  };
  if (out.tokenPresent) {
    try {
      out.me = await whoAmI();
    } catch (err) {
      out.tokenError = err.message;
    }
  }
  res.json(out);
});

r.get('/admin/asana/projects', requireAdmin, async (req, res) => {
  try {
    res.json({ projects: await listProjects(String(req.query.workspace || '')) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

r.post('/admin/asana/connect', requireAdmin, async (req, res) => {
  if (!hasToken()) return res.status(400).json({ error: 'Add ASANA_TOKEN to the .env file and restart the container first.' });
  const projectGid = String(req.body.projectGid || '');
  if (!/^\d+$/.test(projectGid)) return res.status(400).json({ error: 'Pick a project.' });
  let appUrl = String(req.body.appUrl || '').replace(/\/$/, '');
  if (!/^https?:\/\/[^\s]+$/.test(appUrl)) appUrl = null;
  try {
    res.json(await connect({ projectGid, appUrl }));
  } catch (err) {
    res.status(502).json({ error: `Asana: ${err.message}` });
  }
});

r.post('/admin/asana/sync', requireAdmin, (req, res) => {
  if (!getConfig()) return res.status(400).json({ error: 'Connect a project first.' });
  // Keep the "Open in the Idea Library" link in task notes pointing at the address people actually use.
  const appUrl = String(req.body.appUrl || '').replace(/\/$/, '');
  if (/^https?:\/\/[^\s]+$/.test(appUrl)) setAppUrl(appUrl);
  res.json({ queued: syncEverything() });
});

r.post('/admin/asana/disconnect', requireAdmin, (_req, res) => {
  disconnect();
  res.json({ ok: true });
});

export default r;
