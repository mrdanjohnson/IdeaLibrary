import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Flag, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { RATINGS, REPORT_REASONS, STATUSES } from '../constants.js';

export function StatusBadge({ status, size = 'md' }) {
  const s = STATUSES[status] || STATUSES.new;
  return (
    <span className={`status-badge status-${status} size-${size}`} style={{ '--c': s.color }}>
      <span className="status-dot" />
      {s.label}
    </span>
  );
}

export function CategoryTag({ category }) {
  return (
    <span className="cat-tag" style={{ '--c': category.color }}>
      {category.name}
    </span>
  );
}

/** Five pill segments that fill up — the brand's streak shape doubling as a meter. */
export function PassionMeter({ rating, showLabel = true, compact = false }) {
  return (
    <span className={`passion ${compact ? 'compact' : ''}`} title={`Passion ${rating}/5 — ${RATINGS[rating]}`}>
      <span className="passion-bars" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= rating ? 'on' : ''} style={{ '--i': n }} />
        ))}
      </span>
      {showLabel && <span className="passion-label">{RATINGS[rating]}</span>}
      <span className="sr-only">Passion {rating} out of 5</span>
    </span>
  );
}

export function VoteControl({ idea, onChange, horizontal = false }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [state, setState] = useState({ score: idea.score, myVote: idea.myVote });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setState({ score: idea.score, myVote: idea.myVote });
  }, [idea.score, idea.myVote]);

  const cast = async (e, value) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return nav('/login');
    if (idea.isMine) {
      setMsg('Your own idea — we know you love it!');
      setTimeout(() => setMsg(''), 2200);
      return;
    }
    if (busy) return;
    const next = state.myVote === value ? 0 : value;
    setBusy(true);
    // Optimistic update so voting feels instant.
    setState((s) => ({ score: s.score - s.myVote + next, myVote: next }));
    try {
      const r = await api.post(`/ideas/${idea.id}/vote`, { value: next });
      setState({ score: r.score, myVote: r.myVote });
      onChange?.(r);
    } catch (err) {
      setState({ score: idea.score, myVote: idea.myVote });
      setMsg(err.message);
      setTimeout(() => setMsg(''), 2500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`vote ${horizontal ? 'horizontal' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        className={`vote-btn up ${state.myVote === 1 ? 'active' : ''}`}
        aria-label="Vote up"
        aria-pressed={state.myVote === 1}
        onClick={(e) => cast(e, 1)}
      >
        <ChevronUp size={20} strokeWidth={2.5} />
      </button>
      <span className={`vote-score ${state.score > 0 ? 'pos' : state.score < 0 ? 'neg' : ''}`} aria-live="polite">
        {state.score}
      </span>
      <button
        className={`vote-btn down ${state.myVote === -1 ? 'active' : ''}`}
        aria-label="Vote down"
        aria-pressed={state.myVote === -1}
        onClick={(e) => cast(e, -1)}
      >
        <ChevronDown size={20} strokeWidth={2.5} />
      </button>
      {msg && <span className="vote-msg">{msg}</span>}
    </div>
  );
}

export function Modal({ title, eyebrow, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, textarea, select, button:not(.modal-x)')?.focus();
    const key = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-band" aria-hidden="true" />
        <button className="icon-btn modal-x" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ReportButton({ targetType, targetId, small = false }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [detail, setDetail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/reports', { targetType, targetId, reason: detail ? `${reason}: ${detail}` : reason });
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <>
      <button className={`link-btn subtle ${small ? 'small' : ''}`} onClick={() => setOpen(true)}>
        <Flag size={14} /> Report
      </button>
      {open && (
        <Modal title={done ? 'Thanks for letting us know' : `Report this ${targetType}`} eyebrow="Keep it kind" onClose={() => setOpen(false)}>
          {done ? (
            <>
              <p>An admin will take a look. You won’t be identified to the author.</p>
              <div className="modal-actions">
                <button className="btn btn-primary" onClick={() => setOpen(false)}>Done</button>
              </div>
            </>
          ) : (
            <form onSubmit={submit} className="stack">
              <div className="chip-row">
                {REPORT_REASONS.map((r) => (
                  <button type="button" key={r} className={`chip ${reason === r ? 'active' : ''}`} onClick={() => setReason(r)}>
                    {r}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>Anything else? (optional)</span>
                <textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={400} />
              </label>
              {error && <p className="form-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button className="btn btn-primary">Send report</button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}
