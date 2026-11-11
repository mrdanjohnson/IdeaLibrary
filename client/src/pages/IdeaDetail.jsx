import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, BadgeCheck, CalendarDays, Clock, Compass, ExternalLink, EyeOff, Lightbulb, Pencil, PlayCircle, RefreshCw, RotateCcw, Trash2,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { Streaks } from '../components/Brand.jsx';
import { ThumbFallback } from '../components/IdeaCard.jsx';
import StaffPanel from '../components/StaffPanel.jsx';
import { CategoryTag, Modal, PassionMeter, ReportButton, Spinner, StatusBadge, VoteControl } from '../components/bits.jsx';
import { STATUSES, formatDate, formatTime, hostname, timeAgo } from '../constants.js';

function StatusCard({ idea }) {
  const last = [...idea.timeline].reverse().find((t) => t.to === idea.status && t.from !== t.to) || idea.timeline.at(-1);
  const s = STATUSES[idea.status];
  return (
    <div className={`side-card status-card status-${idea.status}`} style={{ '--c': s.color }}>
      <p className="eyebrow">Where it stands</p>
      <StatusBadge status={idea.status} size="lg" />
      <p className="status-blurb">{s.blurb}</p>
      {idea.scheduledFor && ['scheduled', 'in_progress'].includes(idea.status) && (
        <p className="status-date">
          <CalendarDays size={16} /> {formatDate(idea.scheduledFor)}
        </p>
      )}
      {idea.status === 'not_now' && last?.reason && (
        <div className="why-callout">
          <p className="why-label">The why</p>
          <p className="why-reason">{last.reason.label}</p>
          {last.note && <p className="why-note">“{last.note}”</p>}
          {last.revisitOn && (
            <p className="why-revisit">
              <RotateCcw size={14} /> We’ll revisit this around {formatDate(last.revisitOn)}
            </p>
          )}
        </div>
      )}
      {idea.status === 'not_now' && idea.needsWhy && !last?.reason && (
        <div className="why-callout">
          <p className="why-label">The why</p>
          <p className="why-note">Leadership is putting the reasons into words. Check back soon.</p>
        </div>
      )}
      {idea.status !== 'not_now' && last?.note && last.from !== null && <p className="status-note">“{last.note}”</p>}
    </div>
  );
}

function Timeline({ items }) {
  return (
    <ol className="timeline">
      {items.map((t) => {
        const s = STATUSES[t.to];
        const merged = t.from === t.to;
        return (
          <li key={t.id} style={{ '--c': s.color }}>
            <span className="tl-node" />
            <div className="tl-body">
              <div className="tl-head">
                <strong>{t.from === null ? 'Shared with the library' : merged ? 'Combined' : s.label}</strong>
                <span className="muted">{timeAgo(t.createdAt)}{t.by ? ` · ${t.by}` : ''}</span>
              </div>
              {t.scheduledFor && <p className="tl-meta"><CalendarDays size={13} /> {formatDate(t.scheduledFor)}</p>}
              {t.reason && <p className="tl-meta"><Compass size={13} /> {t.reason.label}</p>}
              {t.note && t.from !== null && <p className="tl-note">{t.note}</p>}
              {t.revisitOn && <p className="tl-meta"><RotateCcw size={13} /> Revisit {formatDate(t.revisitOn)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Comment({ c, reload }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body);
  const save = async () => {
    await api.patch(`/comments/${c.id}`, { body });
    setEditing(false);
    reload();
  };
  return (
    <li className={`comment ${c.official ? 'official' : ''} ${c.hidden ? 'is-hidden' : ''}`}>
      <div className="comment-head">
        <span className="avatar sm">{c.author.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
        <strong>{c.author.name}</strong>
        {c.official && <span className="official-tag"><BadgeCheck size={14} /> Leadership reply</span>}
        {c.author.isSubmitter && !c.official && <span className="author-tag">Idea author</span>}
        <span className="muted small">{timeAgo(c.createdAt)}{c.edited ? ' · edited' : ''}</span>
        {c.hidden && <span className="hidden-tag"><EyeOff size={12} /> Hidden</span>}
      </div>
      {editing ? (
        <div className="stack">
          <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="row-end">
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
          </div>
        </div>
      ) : (
        <p className="comment-body">{c.body}</p>
      )}
      <div className="comment-actions">
        {c.canEdit && !editing && <button className="link-btn subtle small" onClick={() => setEditing(true)}>Edit</button>}
        {c.canDelete && (
          <button
            className="link-btn subtle small"
            onClick={async () => {
              if (confirm('Delete this comment?')) {
                await api.del(`/comments/${c.id}`);
                reload();
              }
            }}
          >
            Delete
          </button>
        )}
        {!c.canEdit && <ReportButton targetType="comment" targetId={c.id} small />}
      </div>
    </li>
  );
}

function CommentBox({ idea, reload }) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [official, setOfficial] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!user)
    return (
      <p className="muted">
        <Link to="/login">Sign in</Link> to join the conversation.
      </p>
    );
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/ideas/${idea.id}/comments`, { body, official: idea.canManage ? official : false });
      setBody('');
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="comment-box" onSubmit={submit}>
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={idea.canManage && official ? 'Reply as leadership…' : 'Add to the idea — build on it, ask a question, cheer it on…'}
        maxLength={3000}
      />
      <div className="comment-box-foot">
        {idea.canManage ? (
          <label className="check">
            <input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} /> Post as official leadership reply
          </label>
        ) : <span />}
        <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>Comment</button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}

export default function IdeaDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { state } = useLocation();
  const [idea, setIdea] = useState(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () => api.get(`/ideas/${id}`).then((d) => setIdea(d.idea)).catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    setIdea(null);
    load();
  }, [load]);

  if (error) return <div className="container empty-state" style={{ paddingTop: 80 }}><h1>{error}</h1><Link to="/" className="btn btn-primary">Back to the library</Link></div>;
  if (!idea) return <div className="center-pad"><Spinner /></div>;

  const link = idea.resolvedUrl || idea.url;

  return (
    <div className="detail" style={{ '--c': idea.category.color }}>
      <section className="detail-hero">
        <Streaks variant="diagonal" />
        <div className="container detail-hero-inner">
          <Link to="/" className="back-link"><ArrowLeft size={16} /> All ideas</Link>
          {state?.justSaved && (
            <div className="saved-banner">
              <Lightbulb size={18} /> Your idea is in the library. Leadership and the church can now see it, vote, and respond.
            </div>
          )}
          {idea.mergedIntoIdea && (
            <div className="saved-banner">
              This idea was combined with <Link to={`/ideas/${idea.mergedIntoIdea.id}`}>“{idea.mergedIntoIdea.title}”</Link> so the
              conversation lives in one place.
            </div>
          )}
          {idea.hidden && <div className="saved-banner warn"><EyeOff size={16} /> Hidden from the library. Only you and leadership can see it.</div>}
          <div className="detail-tags">
            <CategoryTag category={idea.category} />
            <StatusBadge status={idea.status} />
          </div>
          <h1 className="detail-title">{idea.title}</h1>
          <p className="detail-by">
            {idea.author ? idea.author.name : 'Shared anonymously'} · {timeAgo(idea.createdAt)}
            {idea.anonymous && idea.author && <span className="anon-note"> (anonymous to members)</span>}
          </p>
        </div>
      </section>

      <div className="container detail-grid">
        <div className="detail-main">
          <div className="detail-media-row">
            <VoteControl idea={idea} />
            <div className="detail-media">
              {idea.youtubeId ? (
                <a href={link} target="_blank" rel="noreferrer" className="media-link">
                  {idea.thumbnail ? <img src={idea.thumbnail} alt="" /> : <ThumbFallback color={idea.category.color} title={idea.title} />}
                  <span className="play-overlay"><PlayCircle size={56} strokeWidth={1.5} /></span>
                </a>
              ) : idea.thumbnail ? (
                <a href={link} target="_blank" rel="noreferrer" className="media-link"><img src={idea.thumbnail} alt="" /></a>
              ) : (
                <ThumbFallback color={idea.category.color} title={idea.title} />
              )}
            </div>
          </div>

          <div className="detail-body">
            <p className="description">{idea.description}</p>

            {link && (
              <a className="link-card" href={link} target="_blank" rel="noreferrer">
                <span>
                  <span className="eyebrow">{idea.youtubeId ? 'Watch the inspiration' : 'Inspiration link'}</span>
                  <strong>{hostname(link)}</strong>
                </span>
                <ExternalLink size={18} />
              </a>
            )}

            {idea.timestamps.length > 0 && (
              <div className="moments">
                <p className="eyebrow">Key moments</p>
                <ul>
                  {idea.timestamps.map((t, i) => (
                    <li key={i}>
                      <a href={t.url} target="_blank" rel="noreferrer">
                        <span className="moment-time"><Clock size={14} /> {formatTime(t.seconds)}</span>
                        <span>{t.label || 'Jump to this moment'}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <dl className="facts">
              <div>
                <dt>Passion</dt>
                <dd><PassionMeter rating={idea.rating} /></dd>
              </div>
              {idea.source && (
                <div>
                  <dt>Source</dt>
                  <dd>{idea.source}</dd>
                </div>
              )}
              <div>
                <dt>Votes</dt>
                <dd>{idea.upvotes} up · {idea.downvotes} down</dd>
              </div>
            </dl>

            <div className="owner-actions">
              {idea.canEdit && (
                <>
                  <Link to={`/ideas/${idea.id}/edit`} className="btn btn-ghost btn-sm"><Pencil size={15} /> Edit</Link>
                  <button className="btn btn-ghost btn-sm danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>
                </>
              )}
              {(idea.canEdit || idea.canManage) && idea.url && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={refreshing}
                  onClick={async () => {
                    setRefreshing(true);
                    await api.post(`/ideas/${idea.id}/thumbnail`).catch(() => {});
                    await load();
                    setRefreshing(false);
                  }}
                >
                  <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> Refresh thumbnail
                </button>
              )}
              {!idea.isMine && <ReportButton targetType="idea" targetId={idea.id} />}
            </div>
          </div>

          <section className="comments-section">
            <h2 className="section-title">Conversation <span className="count">{idea.comments.length}</span></h2>
            <CommentBox idea={idea} reload={load} />
            {idea.comments.length === 0 ? (
              <p className="muted">No comments yet. Be the first to build on this idea.</p>
            ) : (
              <ul className="comment-list">
                {idea.comments.map((c) => <Comment key={c.id} c={c} reload={load} />)}
              </ul>
            )}
          </section>
        </div>

        <aside className="detail-side">
          <StatusCard idea={idea} />
          {idea.canManage && <StaffPanel idea={idea} reload={load} onMerged={(tid) => nav(`/ideas/${tid}`)} />}
          <div className="side-card">
            <p className="eyebrow">Journey</p>
            <Timeline items={idea.timeline} />
          </div>
          {idea.mergedFrom.length > 0 && (
            <div className="side-card">
              <p className="eyebrow">Combined from</p>
              <ul className="plain-list">
                {idea.mergedFrom.map((m) => <li key={m.id}><Link to={`/ideas/${m.id}`}>{m.title}</Link></li>)}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {confirmDelete && (
        <Modal title="Delete this idea?" eyebrow="Heads up" onClose={() => setConfirmDelete(false)}>
          <p>This removes the idea, its votes, and its conversation for everyone. It can’t be undone.</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await api.del(`/ideas/${idea.id}`);
                nav('/');
              }}
            >
              Delete idea
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
