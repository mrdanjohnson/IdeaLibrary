import { useEffect, useState } from 'react';
import { Combine, ExternalLink, Eye, EyeOff, Megaphone, PenLine } from 'lucide-react';
import { api } from '../api.js';
import { Modal } from './bits.jsx';
import { NOT_NOW_REASONS, STATUSES, STATUS_ORDER } from '../constants.js';

function StatusForm({ idea, onDone, onClose }) {
  const [status, setStatus] = useState(idea.status === 'new' ? 'under_review' : idea.status);
  const [note, setNote] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [revisitOn, setRevisitOn] = useState('');
  const [scheduledFor, setScheduledFor] = useState(idea.scheduledFor || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/ideas/${idea.id}/status`, { status, note, reasonCode, revisitOn, scheduledFor });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Update the status" eyebrow="Leadership" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <div className="status-choices">
          {STATUS_ORDER.map((s) => (
            <button
              type="button"
              key={s}
              className={`status-choice ${status === s ? 'active' : ''}`}
              style={{ '--c': STATUSES[s].color }}
              onClick={() => setStatus(s)}
            >
              <span className="status-dot" />
              <span>
                <strong>{STATUSES[s].label}</strong>
                <small>{STATUSES[s].blurb}</small>
              </span>
            </button>
          ))}
        </div>

        {(status === 'scheduled' || status === 'in_progress') && (
          <label className="field">
            <span>{status === 'scheduled' ? 'Scheduled for' : 'Target date (optional)'}</span>
            <input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} required={status === 'scheduled'} />
          </label>
        )}

        {status === 'not_now' && (
          <div className="why-box">
            <p className="why-intro">
              <strong>Share the why behind the what.</strong> People keep dreaming when they understand the decision.
            </p>
            <label className="field">
              <span>Main reason</span>
              <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} required>
                <option value="">Choose a reason…</option>
                {Object.entries(NOT_NOW_REASONS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>We’ll look at this again on (optional)</span>
              <input type="date" value={revisitOn} onChange={(e) => setRevisitOn(e.target.value)} />
            </label>
          </div>
        )}

        <label className="field">
          <span>
            {status === 'not_now' ? 'Explain the why (required)' : 'Note to everyone following this idea (optional)'}
          </span>
          <textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required={status === 'not_now'}
            minLength={status === 'not_now' ? 10 : undefined}
            placeholder={
              status === 'not_now'
                ? 'We love the heart behind this. Right now… What would make it a yes later is…'
                : 'e.g. We’re talking about this with the production team next week.'
            }
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>Update & notify followers</button>
        </div>
      </form>
    </Modal>
  );
}

function MergeForm({ idea, onDone, onClose }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [target, setTarget] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(
      () => api.get(`/ideas?q=${encodeURIComponent(q)}`).then((d) => setResults(d.ideas.filter((i) => i.id !== idea.id).slice(0, 6))),
      250,
    );
    return () => clearTimeout(t);
  }, [q, idea.id]);

  const merge = async () => {
    try {
      await api.post(`/ideas/${idea.id}/merge`, { intoId: target.id });
      onDone(target.id);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title="Combine with another idea" eyebrow="Duplicates" onClose={onClose}>
      <p className="muted">
        This idea’s votes move to the one you pick, and its author gets an upvote there too. This page will point
        people to the combined idea.
      </p>
      <label className="field">
        <span>Find the idea to keep</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title…" />
      </label>
      <ul className="pick-list">
        {results.map((r) => (
          <li key={r.id}>
            <button className={`pick ${target?.id === r.id ? 'active' : ''}`} onClick={() => setTarget(r)}>
              <strong>{r.title}</strong>
              <span className="muted">{r.category.name} · {r.score} votes</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!target} onClick={merge}>Combine ideas</button>
      </div>
    </Modal>
  );
}

export default function StaffPanel({ idea, reload, onMerged }) {
  const [mode, setMode] = useState(null);
  const toggleHidden = async () => {
    await api.post(`/ideas/${idea.id}/visibility`, { hidden: !idea.hidden });
    reload();
  };
  return (
    <div className="side-card staff-card">
      <p className="eyebrow on-dark">Leadership tools</p>
      {idea.needsWhy && (
        <button className="needs-why-prompt" onClick={() => setMode('status')}>
          <PenLine size={16} />
          <span><strong>Add the why.</strong> This was moved to Not Right Now in Asana without a reason.</span>
        </button>
      )}
      <button className="btn btn-light w-full" onClick={() => setMode('status')}>
        <Megaphone size={16} /> Update status
      </button>
      <div className="staff-row">
        <button className="btn btn-outline-light btn-sm" onClick={() => setMode('merge')} disabled={!!idea.mergedInto}>
          <Combine size={15} /> Combine
        </button>
        <button className="btn btn-outline-light btn-sm" onClick={toggleHidden}>
          {idea.hidden ? <Eye size={15} /> : <EyeOff size={15} />} {idea.hidden ? 'Unhide' : 'Hide'}
        </button>
      </div>
      {idea.asanaUrl && (
        <a className="btn btn-outline-light btn-sm w-full" href={idea.asanaUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={15} /> Open in Asana
        </a>
      )}
      <p className="staff-hint">Comments you post here show as official leadership replies.</p>
      {mode === 'status' && (
        <StatusForm
          idea={idea}
          onClose={() => setMode(null)}
          onDone={() => {
            setMode(null);
            reload();
          }}
        />
      )}
      {mode === 'merge' && (
        <MergeForm
          idea={idea}
          onClose={() => setMode(null)}
          onDone={(targetId) => {
            setMode(null);
            onMerged(targetId);
          }}
        />
      )}
    </div>
  );
}
