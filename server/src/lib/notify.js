import { db } from '../db.js';

const insert = db.prepare(
  'INSERT INTO notifications (user_id, idea_id, actor_id, type, message) VALUES (?, ?, ?, ?, ?)',
);

/** Notifies each recipient once, never the person who caused the event. */
export function notify(userIds, { ideaId, actorId, type, message }) {
  for (const uid of new Set(userIds)) {
    if (uid && uid !== actorId) insert.run(uid, ideaId ?? null, actorId ?? null, type, message);
  }
}

/** The submitter plus everyone who has commented on the idea. */
export function ideaFollowers(ideaId) {
  return db
    .prepare(
      `SELECT user_id FROM ideas WHERE id = ?
       UNION SELECT user_id FROM comments WHERE idea_id = ?`,
    )
    .all(ideaId, ideaId)
    .map((r) => r.user_id);
}
