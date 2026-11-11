import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const THUMB_DIR = path.join(DATA_DIR, 'thumbnails');
fs.mkdirSync(THUMB_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'idea-library.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Each entry runs once, in order. Never edit a shipped migration — append a new one.
const migrations = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color       TEXT NOT NULL DEFAULT '#346093',
    description TEXT NOT NULL DEFAULT '',
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Category leads can manage status + post official replies for ideas in their categories.
  CREATE TABLE category_leads (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, category_id)
  );

  CREATE TABLE ideas (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id   INTEGER NOT NULL REFERENCES categories(id),
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    url           TEXT,
    resolved_url  TEXT,
    youtube_id    TEXT,
    source        TEXT NOT NULL DEFAULT '',
    rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    anonymous     INTEGER NOT NULL DEFAULT 0,
    thumbnail     TEXT,
    status        TEXT NOT NULL DEFAULT 'new',
    scheduled_for TEXT,
    hidden        INTEGER NOT NULL DEFAULT 0,
    merged_into   INTEGER REFERENCES ideas(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ideas_category ON ideas(category_id);
  CREATE INDEX ideas_status ON ideas(status);
  CREATE INDEX ideas_user ON ideas(user_id);

  CREATE TABLE idea_timestamps (
    id       INTEGER PRIMARY KEY,
    idea_id  INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    seconds  INTEGER NOT NULL,
    label    TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE votes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idea_id    INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    value      INTEGER NOT NULL CHECK (value IN (-1, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, idea_id)
  );

  CREATE TABLE comments (
    id          INTEGER PRIMARY KEY,
    idea_id     INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    is_official INTEGER NOT NULL DEFAULT 0,
    hidden      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX comments_idea ON comments(idea_id);

  CREATE TABLE status_changes (
    id            INTEGER PRIMARY KEY,
    idea_id       INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    from_status   TEXT,
    to_status     TEXT NOT NULL,
    note          TEXT NOT NULL DEFAULT '',
    reason_code   TEXT,
    revisit_on    TEXT,
    scheduled_for TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX status_changes_idea ON status_changes(idea_id);

  CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idea_id    INTEGER REFERENCES ideas(id) ON DELETE CASCADE,
    actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type       TEXT NOT NULL,
    message    TEXT NOT NULL,
    read_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX notifications_user ON notifications(user_id, read_at);

  CREATE TABLE reports (
    id          INTEGER PRIMARY KEY,
    target_type TEXT NOT NULL CHECK (target_type IN ('idea','comment')),
    target_id   INTEGER NOT NULL,
    idea_id     INTEGER REFERENCES ideas(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // 2 — Asana sync
  `
  ALTER TABLE ideas ADD COLUMN needs_why INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE status_changes ADD COLUMN actor_label TEXT;

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- One Asana task per idea, plus the state we last agreed on, so we can tell which side changed.
  CREATE TABLE asana_tasks (
    idea_id       INTEGER PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
    task_gid      TEXT NOT NULL UNIQUE,
    synced_status TEXT,
    synced_due    TEXT,
    synced_reason TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
const current = db.prepare('SELECT version FROM schema_version').get()?.version ?? 0;
if (current === 0) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
for (let i = current; i < migrations.length; i++) {
  transaction(() => {
    db.exec(migrations[i]);
    db.prepare('UPDATE schema_version SET version = ?').run(i + 1);
  });
}

// Starter categories drawn from New Day's ministry teams. Users can add more.
const DEFAULT_CATEGORIES = [
  ['Worship', '#346093', 'Music, sets, and the worship experience'],
  ['Production', '#123d6f', 'Lighting, sound, stage, and live tech'],
  ['Media', '#211645', 'Video, graphics, social, and storytelling'],
  ['New Day Kids', '#00B3EB', 'Kids ministry, classrooms, and family moments'],
  ['Groups', '#A7BF3A', 'Small groups, coaching, and community'],
  ['Outreach', '#FA1E44', 'Missions, serving our city, and recovery'],
  ['First Impressions', '#FEC925', 'Hosting, parking, hospitality, and security'],
  ['Connect', '#12304c', 'Guest services and next steps'],
  ['Facilities', '#777779', 'Buildings, spaces, and equipment'],
  ['Events', '#346093', 'Gatherings, celebrations, and special services'],
];
if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
  const insert = db.prepare('INSERT INTO categories (name, color, description) VALUES (?, ?, ?)');
  transaction(() => DEFAULT_CATEGORIES.forEach((c) => insert.run(...c)));
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** node:sqlite rejects undefined/boolean params; normalise them. */
export function p(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
