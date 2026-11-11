import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Download, ExternalLink, EyeOff, Flag, Inbox, Lightbulb, MessageCircle, PenLine, RefreshCw, Sparkles, Unplug, Users,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth, useCategories } from '../App.jsx';
import { Spinner, StatusBadge } from '../components/bits.jsx';
import { RATINGS, STATUSES, STATUS_ORDER, formatDate, timeAgo } from '../constants.js';

function Bar({ value, max, color, label, right }) {
  return (
    <div className="hbar">
      <span className="hbar-label">{label}</span>
      <span className="hbar-track">
        <span className="hbar-fill" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%`, background: color }} />
      </span>
      <span className="hbar-val">{right ?? value}</span>
    </div>
  );
}

function Overview() {
  const [s, setS] = useState(null);
  useEffect(() => {
    api.get('/admin/stats').then(setS);
  }, []);
  if (!s) return <Spinner />;
  const statusMax = Math.max(1, ...s.byStatus.map((x) => x.n));
  const catMax = Math.max(1, ...s.byCategory.map((x) => x.n));
  const monthMax = Math.max(1, ...s.byMonth.map((x) => x.n));
  const ratingMax = Math.max(1, ...s.byRating.map((x) => x.n));
  const statusN = Object.fromEntries(s.byStatus.map((x) => [x.status, x.n]));
  const ratingN = Object.fromEntries(s.byRating.map((x) => [x.rating, x.n]));
  const tiles = [
    [Lightbulb, s.totals.ideas, 'Ideas'],
    [Inbox, s.totals.awaiting, 'Awaiting a response'],
    [Users, s.totals.users, 'People'],
    [MessageCircle, s.totals.comments, 'Comments'],
    [Sparkles, s.totals.avg_rating ?? '—', 'Average passion'],
    [Flag, s.totals.open_reports, 'Open reports'],
  ];
  return (
    <div className="stack-lg">
      {s.needsWhy?.length > 0 && (
        <div className="side-card needs-why-card">
          <p className="eyebrow"><PenLine size={14} /> Needs a why</p>
          <p className="muted small">
            These were moved to Not Right Now in Asana without a reason. Open each one, choose <strong>Update status</strong>, and share the why.
          </p>
          <ul className="plain-list">
            {s.needsWhy.map((i) => (
              <li key={i.id}><Link to={`/ideas/${i.id}`}>{i.title}</Link> <span className="muted small">· {timeAgo(i.updated_at)}</span></li>
            ))}
          </ul>
        </div>
      )}
      <div className="stat-tiles">
        {tiles.map(([Icon, v, label]) => (
          <div className="stat-tile" key={label}>
            <Icon size={18} />
            <strong>{v}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="admin-grid">
        <div className="side-card">
          <p className="eyebrow">Needs a response — most loved first</p>
          {s.topIdeas.length === 0 ? (
            <p className="muted">Every idea has a response. Nice work.</p>
          ) : (
            <ul className="plain-list ranked">
              {s.topIdeas.map((i) => (
                <li key={i.id}>
                  <Link to={`/ideas/${i.id}`}>{i.title}</Link>
                  <span className="muted small">{i.score} votes · passion {i.rating}</span>
                  <StatusBadge status={i.status} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="side-card">
          <p className="eyebrow">Ideas by status</p>
          {STATUS_ORDER.map((st) => (
            <Bar key={st} label={STATUSES[st].label} value={statusN[st] || 0} max={statusMax} color={STATUSES[st].color} />
          ))}
        </div>
        <div className="side-card">
          <p className="eyebrow">Where ideas are coming from</p>
          {s.byCategory.filter((c) => c.n > 0).map((c) => (
            <Bar key={c.id} label={c.name} value={c.n} max={catMax} color={c.color} right={`${c.n} · ${c.avg_rating ?? '–'}★`} />
          ))}
          {s.byCategory.every((c) => !c.n) && <p className="muted">No ideas yet.</p>}
        </div>
        <div className="side-card">
          <p className="eyebrow">Passion levels</p>
          {[5, 4, 3, 2, 1].map((r) => (
            <Bar key={r} label={RATINGS[r]} value={ratingN[r] || 0} max={ratingMax} color="var(--light-blue)" />
          ))}
        </div>
        <div className="side-card">
          <p className="eyebrow">New ideas per month</p>
          <div className="month-chart">
            {s.byMonth.map((m) => (
              <div key={m.month} className="month-col" title={`${m.month}: ${m.n}`}>
                <span className="month-bar" style={{ height: `${(m.n / monthMax) * 100}%` }} />
                <span className="month-label">{new Date(m.month + '-02').toLocaleDateString(undefined, { month: 'short' })}</span>
              </div>
            ))}
            {s.byMonth.length === 0 && <p className="muted">No ideas yet.</p>}
          </div>
        </div>
        <div className="side-card">
          <p className="eyebrow">Coming up to revisit</p>
          {s.revisits.length === 0 ? (
            <p className="muted">No “not right now” ideas have a revisit date.</p>
          ) : (
            <ul className="plain-list">
              {s.revisits.map((r) => (
                <li key={r.id}>
                  <Link to={`/ideas/${r.id}`}>{r.title}</Link> <span className="muted small">· {formatDate(r.revisit_on)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Reports() {
  const [status, setStatus] = useState('open');
  const [reports, setReports] = useState(null);
  const load = () => api.get(`/admin/reports?status=${status}`).then((d) => setReports(d.reports));
  useEffect(() => {
    setReports(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  const act = async (id, action) => {
    await api.post(`/admin/reports/${id}`, { action });
    load();
  };
  return (
    <div>
      <div className="chip-row">
        {['open', 'actioned', 'dismissed'].map((s) => (
          <button key={s} className={`chip ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {!reports ? <Spinner /> : reports.length === 0 ? (
        <p className="muted">Nothing here. 🙌</p>
      ) : (
        <ul className="report-list">
          {reports.map((r) => (
            <li key={r.id} className="side-card">
              <div className="report-head">
                <span className="cat-tag">{r.target_type}</span>
                <strong>{r.reason}</strong>
                <span className="muted small">by {r.reporter || 'someone'} · {timeAgo(r.created_at)}</span>
              </div>
              <blockquote>{r.excerpt?.slice(0, 280) || '(deleted)'}</blockquote>
              <div className="row-end">
                <Link to={`/ideas/${r.idea_id}`} className="btn btn-ghost btn-sm">Open “{r.idea_title}”</Link>
                {r.status === 'open' && (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => act(r.id, 'dismiss')}>Dismiss</button>
                    <button className="btn btn-danger btn-sm" onClick={() => act(r.id, 'hide')}><EyeOff size={14} /> Hide {r.target_type}</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const { categories } = useCategories();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const load = () => api.get('/admin/users').then((d) => setUsers(d.users));
  useEffect(() => {
    load();
  }, []);
  const update = async (id, body) => {
    setError('');
    try {
      await api.patch(`/admin/users/${id}`, body);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  if (!users) return <Spinner />;
  const shown = users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      <p className="muted">
        <strong>Admins</strong> can do everything. <strong>Category leads</strong> can update status and post official replies for
        ideas in their categories.
      </p>
      <input className="search-input" placeholder="Find someone…" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p className="form-error">{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Person</th><th>Role</th><th>Leads categories</th><th>Ideas</th><th>Joined</th><th /></tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.name}</strong><br /><span className="muted small">{u.email}</span></td>
                <td>
                  <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })} disabled={u.id === me.id}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>
                  <details className="lead-picker">
                    <summary>{u.leadCategoryIds.length ? categories.filter((c) => u.leadCategoryIds.includes(c.id)).map((c) => c.name).join(', ') : 'None'}</summary>
                    <div className="lead-options">
                      {categories.map((c) => (
                        <label key={c.id} className="check">
                          <input
                            type="checkbox"
                            checked={u.leadCategoryIds.includes(c.id)}
                            onChange={(e) =>
                              update(u.id, {
                                leadCategoryIds: e.target.checked ? [...u.leadCategoryIds, c.id] : u.leadCategoryIds.filter((x) => x !== c.id),
                              })
                            }
                          />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </details>
                </td>
                <td>{u.idea_count}</td>
                <td className="small muted">{formatDate(u.created_at)}</td>
                <td>
                  {u.id !== me.id && (
                    <button
                      className="link-btn subtle small"
                      onClick={async () => {
                        if (confirm(`Remove ${u.name}? Their ideas, votes and comments will be deleted. This can’t be undone.`)) {
                          await api.del(`/admin/users/${u.id}`);
                          load();
                        }
                      }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategoriesTab() {
  const { refreshCategories } = useCategories();
  const [cats, setCats] = useState(null);
  const [error, setError] = useState('');
  const [mergeFrom, setMergeFrom] = useState(null);
  const load = () => api.get('/categories?all=1').then((d) => setCats(d.categories));
  useEffect(() => {
    load();
  }, []);
  const save = async (id, body) => {
    setError('');
    try {
      await api.patch(`/categories/${id}`, body);
      await load();
      refreshCategories();
    } catch (err) {
      setError(err.message);
    }
  };
  if (!cats) return <Spinner />;
  return (
    <div className="stack">
      <p className="muted">Anyone can add a category while sharing an idea. Tidy them up here: rename, recolor, archive, or merge duplicates.</p>
      {error && <p className="form-error">{error}</p>}
      <div className="cat-admin-list">
        {cats.map((c) => (
          <div key={c.id} className={`cat-admin ${c.archived ? 'archived' : ''}`}>
            <input type="color" value={c.color} onChange={(e) => save(c.id, { color: e.target.value })} aria-label={`${c.name} color`} />
            <input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && save(c.id, { name: e.target.value })} aria-label="Name" />
            <input
              className="grow"
              defaultValue={c.description}
              placeholder="Short description"
              onBlur={(e) => e.target.value !== c.description && save(c.id, { description: e.target.value })}
              aria-label="Description"
            />
            <span className="muted small">{c.idea_count} ideas</span>
            <button className="btn btn-ghost btn-sm" onClick={() => save(c.id, { archived: !c.archived })}>{c.archived ? 'Restore' : 'Archive'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setMergeFrom(c)}>Merge…</button>
            {mergeFrom?.id === c.id && (
              <div className="merge-row">
                Move all ideas into
                <select
                  defaultValue=""
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    await api.post(`/categories/${c.id}/merge`, { intoId: Number(e.target.value) });
                    setMergeFrom(null);
                    await load();
                    refreshCategories();
                  }}
                >
                  <option value="">Choose…</option>
                  {cats.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <button className="link-btn small" onClick={() => setMergeFrom(null)}>Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HiddenIdeas() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/ideas?hidden=1&sort=new').then(setData);
  }, []);
  if (!data) return <Spinner />;
  return data.ideas.length === 0 ? (
    <p className="muted">No hidden ideas.</p>
  ) : (
    <ul className="plain-list">
      {data.ideas.map((i) => (
        <li key={i.id}><Link to={`/ideas/${i.id}`}>{i.title}</Link> <span className="muted small">· {i.category.name}</span></li>
      ))}
    </ul>
  );
}

function AsanaTab() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [projects, setProjects] = useState(null);
  const [projectGid, setProjectGid] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get('/admin/asana').then((x) => {
      setD(x);
      return x;
    });
  useEffect(() => {
    load().then((x) => x.me?.workspaces?.[0] && setWorkspace(x.me.workspaces[0].gid));
  }, []);
  // Keep the status fresh while a sync runs or the tab is open.
  useEffect(() => {
    const t = setInterval(load, d?.status?.syncing ? 2000 : 15000);
    return () => clearInterval(t);
  }, [d?.status?.syncing]);
  useEffect(() => {
    if (!workspace || !(picking || (d && !d.config))) return;
    setProjects(null);
    api.get(`/admin/asana/projects?workspace=${workspace}`).then((x) => setProjects(x.projects)).catch((e) => setError(e.message));
  }, [workspace, picking, d?.config]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const connect = () =>
    run(async () => {
      await api.post('/admin/asana/connect', { projectGid, appUrl: window.location.origin });
      setPicking(false);
    });

  if (!d) return <Spinner />;

  if (!d.tokenPresent)
    return (
      <div className="side-card asana-setup stack">
        <p className="eyebrow">Connect Asana</p>
        <h2>Add your Asana token to the server</h2>
        <ol className="steps">
          <li>In Asana, open your profile photo → <strong>Settings → Apps → Developer apps</strong> (the Developer console) and create a <strong>personal access token</strong>.</li>
          <li>Next to <code>docker-compose.yml</code> on the NAS, create a file named <code>.env</code> containing one line:<pre>ASANA_TOKEN=paste-your-token-here</pre></li>
          <li>Restart the project: Container Manager → Project → <strong>Action → Build</strong> (or <code>sudo docker compose up -d</code>).</li>
          <li>Come back to this page.</li>
        </ol>
        <p className="muted small">The token stays on the NAS. It is never shown here or sent to anyone but Asana.</p>
      </div>
    );

  const cfg = d.config;
  const st = d.status || {};
  const picker = (
    <div className="stack">
      {d.me?.workspaces?.length > 1 && (
        <label className="field">
          <span>Workspace</span>
          <select value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
            {d.me.workspaces.map((w) => <option key={w.gid} value={w.gid}>{w.name}</option>)}
          </select>
        </label>
      )}
      <label className="field">
        <span>Project</span>
        {!projects ? <Spinner /> : (
          <select value={projectGid} onChange={(e) => setProjectGid(e.target.value)}>
            <option value="">Choose a project…</option>
            {projects.map((p) => <option key={p.gid} value={p.gid}>{p.name}</option>)}
          </select>
        )}
      </label>
      <p className="muted small">
        The Idea Library adds the sections <strong>{Object.values(d.sectionNames).join(', ')}</strong> (it reuses any that already exist) and a
        “{d.reasonFieldName}” dropdown, then adds the {d.eligible} idea{d.eligible === 1 ? '' : 's'} already past New. Tip: try it on a test project first.
      </p>
      <div className="row-end">
        {cfg && <button className="btn btn-ghost" onClick={() => setPicking(false)}>Cancel</button>}
        <button className="btn btn-primary" disabled={!projectGid || busy} onClick={connect}>{busy ? 'Connecting…' : 'Connect project'}</button>
      </div>
    </div>
  );

  return (
    <div className="stack-lg">
      {error && <p className="form-error">{error}</p>}
      {d.tokenError && (
        <div className="side-card asana-alert"><AlertTriangle size={18} /> <span>{d.tokenError}</span></div>
      )}
      {!cfg || picking ? (
        <div className="side-card stack">
          <p className="eyebrow">{cfg ? 'Change project' : 'Connect Asana'}</p>
          {d.me && <p>Signed in to Asana as <strong>{d.me.name}</strong>.</p>}
          {d.me && picker}
        </div>
      ) : (
        <>
          <div className="side-card asana-status">
            <div className="asana-status-head">
              <CheckCircle2 size={22} className="ok-icon" />
              <div>
                <p className="eyebrow">Connected</p>
                <h2><a href={cfg.projectUrl} target="_blank" rel="noreferrer">{cfg.projectName} <ExternalLink size={15} /></a></h2>
                <p className="muted small">as {d.me?.name || 'your Asana token'} · {d.linked} of {d.eligible} ideas linked</p>
              </div>
            </div>
            <p className="small">
              {st.syncing ? 'Syncing now…' : st.lastPollAt ? `Last checked Asana ${timeAgo(st.lastPollAt.replace('T', ' ').slice(0, 19))}.` : 'Waiting for the first check.'}{' '}
              Changes here go to Asana right away; changes in Asana show up here within about a minute.
            </p>
            {st.warning && <p className="asana-alert small"><AlertTriangle size={15} /> {st.warning}</p>}
            {st.lastError && (
              <p className="asana-alert small"><AlertTriangle size={15} /> Last problem ({timeAgo(st.lastError.at.replace('T', ' ').slice(0, 19))}): {st.lastError.message}</p>
            )}
            <div className="row-end">
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setPicking(true)}>Change project</button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() =>
                  confirm('Stop syncing with Asana? Tasks already in Asana stay there; they just stop updating.') &&
                  run(() => api.post('/admin/asana/disconnect'))
                }
              >
                <Unplug size={14} /> Disconnect
              </button>
              <button className="btn btn-primary btn-sm" disabled={busy || st.syncing} onClick={() => run(() => api.post('/admin/asana/sync', { appUrl: window.location.origin }))}>
                <RefreshCw size={14} /> Sync now
              </button>
            </div>
          </div>
          <div className="side-card">
            <p className="eyebrow">How it works</p>
            <ul className="asana-rules">
              <li><strong>Each column on What’s Happening is a section in Asana.</strong> Drag a task to another section and the idea moves here (and its followers are notified).</li>
              <li><strong>New ideas stay out of Asana</strong> until leadership moves them to Under Review or beyond. Moving an idea back to New, hiding, combining or deleting it removes its task.</li>
              <li><strong>Ticking a task complete</strong> marks the idea Done. The due date is the scheduled date, both ways.</li>
              <li><strong>Not Right Now:</strong> set the “{d.reasonFieldName}” dropdown in Asana. Without it, the idea is flagged on the Overview so someone writes the why here.</li>
              <li><strong>Title and description belong to the Idea Library.</strong> Edits in Asana get overwritten. Leadership replies and status notes are copied to the task as comments.</li>
              <li><strong>Deleted a task in Asana?</strong> It comes back on the next change or Sync now while the idea is on the board. To take it off, move the idea back to New here.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  return (
    <div className="container admin">
      <div className="admin-head">
        <div>
          <p className="eyebrow">Leadership</p>
          <h1>Dashboard</h1>
        </div>
        <a className="btn btn-ghost" href="/api/admin/export.csv"><Download size={16} /> Export CSV</a>
      </div>
      <nav className="tabs">
        <NavLink to="/admin" end>Overview</NavLink>
        {isAdmin && <NavLink to="/admin/reports">Reports</NavLink>}
        {isAdmin && <NavLink to="/admin/users">People & roles</NavLink>}
        {isAdmin && <NavLink to="/admin/categories">Categories</NavLink>}
        {isAdmin && <NavLink to="/admin/hidden">Hidden</NavLink>}
        {isAdmin && <NavLink to="/admin/asana">Asana</NavLink>}
      </nav>
      <Routes>
        <Route index element={<Overview />} />
        {isAdmin && <Route path="reports" element={<Reports />} />}
        {isAdmin && <Route path="users" element={<UsersTab />} />}
        {isAdmin && <Route path="categories" element={<CategoriesTab />} />}
        {isAdmin && <Route path="hidden" element={<HiddenIdeas />} />}
        {isAdmin && <Route path="asana" element={<AsanaTab />} />}
      </Routes>
    </div>
  );
}
