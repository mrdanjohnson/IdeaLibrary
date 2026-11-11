// Two-way sync between idea status and sections in one Asana project.
//
// Platform → Asana: pushed right away (through a serial queue) whenever an idea changes.
// Asana → platform: the NAS is LAN-only, so Asana can't call us (webhooks). Instead we poll
// Asana's events feed for the project every ASANA_POLL_SECONDS and re-read the tasks that changed.
//
// asana_tasks keeps the state both sides last agreed on. If Asana's state differs from it,
// someone changed it in Asana; if the platform differs, the change came from here.

import { db, transaction, p } from '../db.js';
import { STATUSES, RATING_LABELS } from './constants.js';
import { notify, ideaFollowers } from './notify.js';

const API = (process.env.ASANA_API_BASE || 'https://app.asana.com/api/1.0').replace(/\/$/, '');
const POLL_MS = Math.max(15, Number(process.env.ASANA_POLL_SECONDS) || 60) * 1000;

export const SECTION_NAMES = {
  under_review: 'Under Review',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  done: 'Done',
  not_now: 'Not Right Now',
};
export const REASON_FIELD_NAME = 'Why (Not Right Now)';
const REASON_OPTION_NAMES = {
  timing: 'Timing',
  budget: 'Budget',
  capacity: 'Capacity',
  vision: 'Vision',
  exists: 'Already happening',
  details: 'Needs more detail',
  other: 'Other',
};

const token = () => (process.env.ASANA_TOKEN || '').trim();
export const hasToken = () => !!token();
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---- Settings ---------------------------------------------------------------

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}
function setSetting(key, value) {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      JSON.stringify(value),
    );
}
export const getConfig = () => getSetting('asana');
export const getStatusInfo = () => getSetting('asana_status') || {};
const setStatusInfo = (patch) => setSetting('asana_status', { ...getStatusInfo(), ...patch });
export const isActive = () => hasToken() && !!getConfig()?.projectGid;

// ---- HTTP -------------------------------------------------------------------

export class AsanaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(method, path, body, { allow412 = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: {
        authorization: `Bearer ${token()}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify({ data: body }) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429) {
      await sleep(Math.min(Number(res.headers.get('retry-after')) || 30, 60) * 1000);
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (allow412 && res.status === 412) return { status: 412, json };
    if (!res.ok) {
      const msg = json.errors?.[0]?.message || `Asana returned ${res.status}`;
      throw new AsanaError(res.status, res.status === 401 ? 'Asana rejected the token (check ASANA_TOKEN).' : msg);
    }
    return allow412 ? { status: res.status, json } : json;
  }
  throw new AsanaError(429, 'Asana is rate-limiting us; will try again later.');
}

async function getAll(path) {
  const out = [];
  let offset = null;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const j = await call('GET', `${path}${sep}limit=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`);
    out.push(...(j.data || []));
    offset = j.next_page?.offset;
  } while (offset);
  return out;
}

// ---- Serial work queue (keeps Asana calls in order and off the request path) ----

let chain = Promise.resolve();
function enqueue(label, fn) {
  chain = chain
    .then(fn)
    .catch((err) => {
      console.error(`[asana] ${label}: ${err.message}`);
      setStatusInfo({ lastError: { at: new Date().toISOString(), message: `${label}: ${err.message}` } });
    });
  return chain;
}

// ---- Platform → Asana -------------------------------------------------------

function ideaRow(id) {
  return db
    .prepare(
      `SELECT i.*, c.name AS category_name, u.name AS author_name,
         COALESCE((SELECT SUM(value) FROM votes WHERE idea_id = i.id), 0) AS score
       FROM ideas i JOIN categories c ON c.id = i.category_id JOIN users u ON u.id = i.user_id
       WHERE i.id = ?`,
    )
    .get(id);
}

function latestReason(ideaId) {
  return (
    db
      .prepare("SELECT reason_code FROM status_changes WHERE idea_id = ? AND to_status = 'not_now' ORDER BY id DESC LIMIT 1")
      .get(ideaId)?.reason_code ?? null
  );
}

function taskNotes(row, cfg) {
  const lines = [row.description, ''];
  if (row.resolved_url || row.url) lines.push(`Link: ${row.resolved_url || row.url}`);
  lines.push(`Category: ${row.category_name}`, `Shared by: ${row.anonymous ? 'Anonymous' : row.author_name}`);
  if (row.source) lines.push(`Source: ${row.source}`);
  lines.push(`Passion: ${row.rating}/5 (${RATING_LABELS[row.rating]})`, `Votes: ${row.score}`);
  if (cfg.appUrl) lines.push('', `Open in the Idea Library: ${cfg.appUrl}/ideas/${row.id}`);
  lines.push(
    '',
    '— Synced from the New Day Idea Library. Edit the title and description there (changes made here get overwritten). Move this task between sections to change its status.',
  );
  return lines.join('\n');
}

const wantsTask = (row) => row && !row.merged_into && !row.hidden && row.status !== 'new';
const dueFor = (row) => (['scheduled', 'in_progress', 'done'].includes(row.status) ? row.scheduled_for || null : null);

async function deleteTask(gid) {
  try {
    await call('DELETE', `/tasks/${gid}`);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

/** Makes the Asana task match the idea: creates, updates, moves, or removes it. */
async function pushIdea(ideaId, { forceSection = false } = {}) {
  if (!isActive()) return;
  const cfg = getConfig();
  const row = ideaRow(ideaId);
  let link = db.prepare('SELECT * FROM asana_tasks WHERE idea_id = ?').get(ideaId);

  if (!wantsTask(row)) {
    if (link) {
      await deleteTask(link.task_gid);
      db.prepare('DELETE FROM asana_tasks WHERE idea_id = ?').run(ideaId);
    }
    return;
  }

  const reason = row.status === 'not_now' ? latestReason(ideaId) : null;
  const due = dueFor(row);
  const data = { name: row.title, notes: taskNotes(row, cfg), due_on: due, completed: row.status === 'done' };
  if (cfg.reasonField) data.custom_fields = { [cfg.reasonField.gid]: (reason && cfg.reasonField.options[reason]) || null };

  let gid = link?.task_gid;
  if (gid) {
    try {
      await call('PUT', `/tasks/${gid}`, data);
    } catch (err) {
      if (err.status !== 404) throw err;
      // Deleted in Asana: make a fresh one.
      db.prepare('DELETE FROM asana_tasks WHERE idea_id = ?').run(ideaId);
      gid = null;
      link = null;
    }
  }
  if (!gid) gid = (await call('POST', '/tasks', { ...data, projects: [cfg.projectGid] })).data.gid;
  if (!link || forceSection || link.synced_status !== row.status) {
    await call('POST', `/sections/${cfg.sections[row.status]}/addTask`, { task: gid });
  }

  db.prepare(
    `INSERT INTO asana_tasks (idea_id, task_gid, synced_status, synced_due, synced_reason) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(idea_id) DO UPDATE SET task_gid = excluded.task_gid, synced_status = excluded.synced_status,
       synced_due = excluded.synced_due, synced_reason = excluded.synced_reason, updated_at = datetime('now')`,
  ).run(ideaId, gid, row.status, p(due), p(reason));
}

async function postStory(ideaId, text) {
  if (!isActive()) return;
  const link = db.prepare('SELECT task_gid FROM asana_tasks WHERE idea_id = ?').get(ideaId);
  if (link) await call('POST', `/tasks/${link.task_gid}/stories`, { text });
}

/** Hooks the routes call. All no-ops unless Asana is connected. */
export const asanaSync = {
  ideaChanged(ideaId) {
    if (isActive()) enqueue(`update idea ${ideaId}`, () => pushIdea(ideaId));
  },
  /** Call before deleting the idea row (the link row is removed with it). */
  ideaDeleting(ideaIds) {
    if (!isActive()) return;
    const ids = [].concat(ideaIds);
    if (!ids.length) return;
    const gids = db
      .prepare(`SELECT task_gid FROM asana_tasks WHERE idea_id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids)
      .map((r) => r.task_gid);
    for (const gid of gids) enqueue(`delete task ${gid}`, () => deleteTask(gid));
  },
  comment(ideaId, text) {
    if (isActive()) enqueue(`comment on idea ${ideaId}`, () => postStory(ideaId, text));
  },
};

// ---- Asana → platform -------------------------------------------------------

function statusFromTask(task, link, cfg) {
  const membership = task.memberships?.find((m) => m.project?.gid === cfg.projectGid);
  if (!membership) return { removed: true };
  const sectionStatus = Object.keys(cfg.sections).find((k) => cfg.sections[k] === membership.section?.gid) || null;
  let status;
  if (sectionStatus && sectionStatus !== link.synced_status) status = sectionStatus; // dragged to another column
  else if (task.completed && link.synced_status !== 'done') status = 'done'; // ticked complete
  else if (!task.completed && link.synced_status === 'done') status = sectionStatus === 'done' ? 'in_progress' : sectionStatus; // un-ticked
  else status = link.synced_status;

  let reason = null;
  if (cfg.reasonField) {
    const optionGid = task.custom_fields?.find((f) => f.gid === cfg.reasonField.gid)?.enum_value?.gid;
    reason = Object.keys(cfg.reasonField.options).find((k) => cfg.reasonField.options[k] === optionGid) || null;
  }
  return { status, due: task.due_on || null, reason, sectionStatus, completed: !!task.completed };
}

async function pullTask(gid, actorName) {
  const link = db.prepare('SELECT * FROM asana_tasks WHERE task_gid = ?').get(gid);
  if (!link) return; // a task someone made by hand in Asana — not ours
  const cfg = getConfig();
  let task;
  try {
    task = (
      await call(
        'GET',
        `/tasks/${gid}?opt_fields=completed,due_on,memberships.project.gid,memberships.section.gid,custom_fields.gid,custom_fields.enum_value.gid`,
      )
    ).data;
  } catch (err) {
    if (err.status !== 404) throw err;
    task = null;
  }
  // Deleted in Asana or taken out of the project: stop syncing it, leave the idea alone.
  const a = task ? statusFromTask(task, link, cfg) : { removed: true };
  if (a.removed) {
    db.prepare('DELETE FROM asana_tasks WHERE task_gid = ?').run(gid);
    return;
  }
  if (!a.status) return; // moved into a section we don't know; ignore

  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(link.idea_id);
  if (!row) return;
  const by = actorName ? `${actorName} (in Asana)` : 'Asana';
  const statusChanged = a.status !== link.synced_status && a.status !== row.status;
  const dueChanged = a.due !== (link.synced_due || null);
  const reasonChanged = a.reason !== (link.synced_reason || null);
  const followers = () => [
    ...ideaFollowers(row.id),
    ...db.prepare('SELECT user_id FROM votes WHERE idea_id = ? AND value = 1').all(row.id).map((x) => x.user_id),
  ];

  if (statusChanged) {
    const to = a.status;
    let scheduledFor = null;
    if (['scheduled', 'in_progress'].includes(to)) scheduledFor = a.due || row.scheduled_for || null;
    if (to === 'done') scheduledFor = row.scheduled_for;
    const reason = to === 'not_now' ? a.reason : null;
    const needsWhy = to === 'not_now' && !reason ? 1 : 0;
    transaction(() => {
      db.prepare(
        `INSERT INTO status_changes (idea_id, user_id, from_status, to_status, note, reason_code, scheduled_for, actor_label)
         VALUES (?, NULL, ?, ?, '', ?, ?, ?)`,
      ).run(row.id, row.status, to, p(reason), p(scheduledFor), by);
      db.prepare("UPDATE ideas SET status = ?, scheduled_for = ?, needs_why = ?, updated_at = datetime('now') WHERE id = ?").run(
        to,
        p(scheduledFor),
        needsWhy,
        row.id,
      );
    });
    notify(followers(), {
      ideaId: row.id,
      type: 'status',
      message: `“${row.title}” is now ${STATUSES[to]}${scheduledFor && to !== 'done' ? ` (${scheduledFor})` : ''}`,
    });
    if (needsWhy) notifyStaffNeedsWhy(row);
  } else {
    if (row.status === 'not_now' && reasonChanged && a.reason) {
      // Reason picked in Asana after the move: fill in the why.
      transaction(() => {
        db.prepare(
          `UPDATE status_changes SET reason_code = ? WHERE id =
             (SELECT MAX(id) FROM status_changes WHERE idea_id = ? AND to_status = 'not_now')`,
        ).run(a.reason, row.id);
        db.prepare('UPDATE ideas SET needs_why = 0 WHERE id = ?').run(row.id);
      });
      if (row.needs_why)
        notify(followers(), { ideaId: row.id, type: 'status', message: `Leadership shared the why behind “${row.title}”` });
    }
    if (dueChanged && a.due && ['scheduled', 'in_progress'].includes(row.status) && a.due !== row.scheduled_for) {
      db.prepare("UPDATE ideas SET scheduled_for = ?, updated_at = datetime('now') WHERE id = ?").run(a.due, row.id);
      notify(followers(), { ideaId: row.id, type: 'status', message: `“${row.title}” is now planned for ${a.due}` });
    }
  }

  // Record the agreed state, then tidy the task (e.g. ticked complete → move to Done).
  db.prepare("UPDATE asana_tasks SET synced_status = ?, synced_due = ?, synced_reason = ?, updated_at = datetime('now') WHERE task_gid = ?").run(
    a.status,
    p(a.due),
    p(a.reason),
    gid,
  );
  const fresh = db.prepare('SELECT status FROM ideas WHERE id = ?').get(row.id);
  const tidy = a.sectionStatus !== fresh.status || a.completed !== (fresh.status === 'done');
  if (statusChanged || tidy) await pushIdea(row.id, { forceSection: tidy });
}

function notifyStaffNeedsWhy(row) {
  const staff = db
    .prepare("SELECT id FROM users WHERE role = 'admin' UNION SELECT user_id FROM category_leads WHERE category_id = ?")
    .all(row.category_id)
    .map((x) => x.id);
  notify(staff, {
    ideaId: row.id,
    type: 'needs_why',
    message: `“${row.title}” was moved to Not Right Now in Asana. Add the why so its author understands.`,
  });
}

async function poll() {
  if (!isActive()) return;
  const cfg = getConfig();
  let sync = getSetting('asana_sync');
  const touched = new Map(); // task gid → name of whoever touched it last
  let fullResync = false;
  for (let page = 0; page < 50; page++) {
    const r = await call('GET', `/events?resource=${cfg.projectGid}${sync ? `&sync=${encodeURIComponent(sync)}` : ''}`, null, {
      allow412: true,
    });
    if (r.status === 412) {
      // No token yet (first run) or it expired (we were offline a long time): check every task.
      fullResync = !!sync;
      setSetting('asana_sync', r.json.sync);
      break;
    }
    for (const ev of r.json.data || []) {
      if (ev.resource?.resource_type === 'task') touched.set(ev.resource.gid, ev.user?.name || touched.get(ev.resource.gid) || null);
    }
    sync = r.json.sync;
    setSetting('asana_sync', sync);
    if (!r.json.has_more) break;
  }
  const gids = fullResync ? db.prepare('SELECT task_gid FROM asana_tasks').all().map((x) => x.task_gid) : [...touched.keys()];
  for (const gid of gids) await pullTask(gid, touched.get(gid));
  setStatusInfo({ lastPollAt: new Date().toISOString(), lastError: null });
}

let timer = null;
export function startAsanaPolling() {
  if (timer) return;
  const tick = () => {
    if (isActive()) enqueue('check Asana for changes', poll);
  };
  setTimeout(tick, 5000);
  timer = setInterval(tick, POLL_MS);
  timer.unref?.();
  if (hasToken()) console.log(`Asana sync: token found, checking every ${POLL_MS / 1000}s once a project is connected.`);
}

// ---- Admin: connect / sync / disconnect -------------------------------------

export async function whoAmI() {
  const me = (await call('GET', '/users/me?opt_fields=name,email,workspaces.name')).data;
  return { name: me.name, email: me.email, workspaces: me.workspaces.map((w) => ({ gid: w.gid, name: w.name })) };
}

export async function listProjects(workspaceGid) {
  const projects = await getAll(`/projects?workspace=${encodeURIComponent(workspaceGid)}&archived=false&opt_fields=name`);
  return projects.map((x) => ({ gid: x.gid, name: x.name })).sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureReasonField(projectGid, workspaceGid) {
  const fieldOpts = 'custom_field.name,custom_field.resource_subtype,custom_field.enum_options.name,custom_field.enum_options.enabled';
  const settings = await getAll(`/projects/${projectGid}/custom_field_settings?opt_fields=${fieldOpts}`);
  let field = settings.map((s) => s.custom_field).find((f) => f?.name === REASON_FIELD_NAME);
  if (!field) {
    try {
      field = (
        await call('POST', '/custom_fields', {
          workspace: workspaceGid,
          name: REASON_FIELD_NAME,
          resource_subtype: 'enum',
          description: 'Why an idea is Not Right Now. Synced with the New Day Idea Library.',
          enum_options: Object.values(REASON_OPTION_NAMES).map((name) => ({ name })),
        })
      ).data;
    } catch (err) {
      // Probably already exists in the workspace (from an earlier project): reuse it.
      const existing = await getAll(
        `/workspaces/${workspaceGid}/custom_fields?opt_fields=name,resource_subtype,enum_options.name,enum_options.enabled`,
      )
        .then((list) => list.find((f) => f.name === REASON_FIELD_NAME))
        .catch(() => null);
      if (!existing) throw err; // report Asana's original reason (e.g. premium feature)
      field = existing;
    }
    await call('POST', `/projects/${projectGid}/addCustomFieldSetting`, { custom_field: field.gid });
  }
  if (field.resource_subtype && field.resource_subtype !== 'enum') throw new Error(`“${REASON_FIELD_NAME}” exists but isn’t a dropdown`);
  const options = {};
  for (const [code, name] of Object.entries(REASON_OPTION_NAMES)) {
    let opt = field.enum_options?.find((o) => o.name === name && o.enabled !== false);
    if (!opt) opt = (await call('POST', `/custom_fields/${field.gid}/enum_options`, { name })).data;
    options[code] = opt.gid;
  }
  return { gid: field.gid, options };
}

export async function connect({ projectGid, appUrl }) {
  const proj = (await call('GET', `/projects/${projectGid}?opt_fields=name,workspace.gid,permalink_url`)).data;
  const existing = await getAll(`/projects/${projectGid}/sections?opt_fields=name`);
  const sections = {};
  for (const [status, name] of Object.entries(SECTION_NAMES)) {
    let s = existing.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    if (!s) s = (await call('POST', `/projects/${projectGid}/sections`, { name })).data;
    sections[status] = s.gid;
  }
  let reasonField = null;
  let warning = null;
  try {
    reasonField = await ensureReasonField(projectGid, proj.workspace.gid);
  } catch (err) {
    warning =
      `Couldn’t add the “${REASON_FIELD_NAME}” dropdown to the project (${err.message}). Custom fields need a paid Asana plan. ` +
      'Everything else syncs; ideas moved to Not Right Now in Asana will be flagged so someone adds the why here.';
  }

  const old = getConfig();
  if (old?.projectGid !== projectGid) {
    db.exec('DELETE FROM asana_tasks');
    setSetting('asana_sync', null);
  }
  setSetting('asana', {
    projectGid,
    projectName: proj.name,
    projectUrl: proj.permalink_url || `https://app.asana.com/0/${projectGid}`,
    workspaceGid: proj.workspace.gid,
    sections,
    reasonField,
    appUrl: appUrl || old?.appUrl || null,
    connectedAt: new Date().toISOString(),
  });
  setStatusInfo({ lastError: null, warning });
  await enqueue('get Asana change feed', poll); // grabs the first sync token
  syncEverything();
  return { warning };
}

/** Pushes every idea that belongs in Asana, then re-checks every linked task. */
export function syncEverything() {
  const ids = db
    .prepare(
      `SELECT id FROM ideas WHERE (status != 'new' AND hidden = 0 AND merged_into IS NULL)
       OR id IN (SELECT idea_id FROM asana_tasks)`,
    )
    .all()
    .map((x) => x.id);
  setStatusInfo({ syncing: true });
  enqueue('check Asana for changes', poll); // take Asana's pending changes first
  for (const id of ids) enqueue(`sync idea ${id}`, () => pushIdea(id));
  enqueue('finish sync', async () => setStatusInfo({ syncing: false, lastFullSyncAt: new Date().toISOString() }));
  return ids.length;
}

export function setAppUrl(appUrl) {
  const cfg = getConfig();
  if (cfg && cfg.appUrl !== appUrl) setSetting('asana', { ...cfg, appUrl });
}

export function disconnect() {
  setSetting('asana', null);
  setSetting('asana_sync', null);
  setSetting('asana_status', null);
  db.exec('DELETE FROM asana_tasks');
}

export function taskUrl(ideaId) {
  const cfg = getConfig();
  if (!cfg) return null;
  const link = db.prepare('SELECT task_gid FROM asana_tasks WHERE idea_id = ?').get(ideaId);
  return link ? `https://app.asana.com/0/${cfg.projectGid}/${link.task_gid}` : null;
}

