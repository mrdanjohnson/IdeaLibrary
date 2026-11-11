import { Router } from 'express';
import { db, transaction } from '../db.js';
import { requireUser, requireAdmin } from '../auth.js';

const r = Router();
const PALETTE = ['#346093', '#123d6f', '#211645', '#12304c', '#00B3EB', '#A7BF3A', '#FA1E44', '#FEC925', '#777779'];
const HEX = /^#[0-9a-fA-F]{6}$/;

r.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM ideas i WHERE i.category_id = c.id AND i.hidden = 0 AND i.merged_into IS NULL) AS idea_count
       FROM categories c
       WHERE c.archived = 0 OR ? = 1
       ORDER BY c.name COLLATE NOCASE`,
    )
    .all(req.user?.role === 'admin' && req.query.all === '1' ? 1 : 0);
  res.json({ categories: rows });
});

// Any signed-in member can add a category.
r.post('/', requireUser, (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const description = String(req.body.description || '').trim().slice(0, 200);
  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Category names are 2–40 characters.' });
  const existing = db.prepare('SELECT * FROM categories WHERE name = ?').get(name);
  if (existing) {
    if (existing.archived) db.prepare('UPDATE categories SET archived = 0 WHERE id = ?').run(existing.id);
    return res.json({ category: { ...existing, archived: 0 }, existed: true });
  }
  const n = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO categories (name, description, color, created_by) VALUES (?, ?, ?, ?)')
    .run(name, description, PALETTE[n % PALETTE.length], req.user.id);
  res.status(201).json({ category: db.prepare('SELECT * FROM categories WHERE id = ?').get(lastInsertRowid) });
});

r.patch('/:id', requireAdmin, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Category not found.' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : cat.name;
  const color = req.body.color !== undefined ? String(req.body.color) : cat.color;
  const description = req.body.description !== undefined ? String(req.body.description).slice(0, 200) : cat.description;
  const archived = req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : cat.archived;
  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Category names are 2–40 characters.' });
  if (!HEX.test(color)) return res.status(400).json({ error: 'Color must be a hex value like #346093.' });
  const clash = db.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(name, cat.id);
  if (clash) return res.status(409).json({ error: 'Another category already has that name.' });
  db.prepare('UPDATE categories SET name = ?, color = ?, description = ?, archived = ? WHERE id = ?').run(
    name,
    color,
    description,
    archived,
    cat.id,
  );
  res.json({ category: db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id) });
});

// Fold a duplicate category (e.g. "Kids" + "New Day Kids") into another.
r.post('/:id/merge', requireAdmin, (req, res) => {
  const from = Number(req.params.id);
  const into = Number(req.body.intoId);
  if (!into || from === into) return res.status(400).json({ error: 'Pick a different category to merge into.' });
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(into)) return res.status(404).json({ error: 'Target not found.' });
  transaction(() => {
    db.prepare('UPDATE ideas SET category_id = ? WHERE category_id = ?').run(into, from);
    db.prepare('INSERT OR IGNORE INTO category_leads (user_id, category_id) SELECT user_id, ? FROM category_leads WHERE category_id = ?').run(into, from);
    db.prepare('DELETE FROM categories WHERE id = ?').run(from);
  });
  res.json({ ok: true });
});

export default r;
