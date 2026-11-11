import { useEffect, useRef, useState } from 'react';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { Modal } from './bits.jsx';
import { formatTime, parseTime } from '../constants.js';

let ytApiPromise;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  ytApiPromise ||= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

/**
 * Pops up when a YouTube link is pasted. People can type times (2:10, 1:02:15, 95)
 * or scrub the embedded video and grab the current moment.
 */
export default function TimestampDialog({ videoId, initial, onSave, onClose }) {
  const [rows, setRows] = useState(() =>
    initial.length ? initial.map((t) => ({ time: formatTime(t.seconds), label: t.label })) : [{ time: '', label: '' }],
  );
  const [error, setError] = useState('');
  const [playerReady, setPlayerReady] = useState(false);
  const holder = useRef(null);
  const player = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !holder.current) return;
        player.current = new YT.Player(holder.current, {
          videoId,
          playerVars: { rel: 0, modestbranding: 1 },
          events: { onReady: () => !cancelled && setPlayerReady(true) },
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      player.current?.destroy?.();
    };
  }, [videoId]);

  const update = (i, patch) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const grab = () => {
    const t = Math.floor(player.current?.getCurrentTime?.() || 0);
    setRows((r) => {
      const emptyIdx = r.findIndex((row) => !row.time.trim());
      if (emptyIdx >= 0) return r.map((row, j) => (j === emptyIdx ? { ...row, time: formatTime(t) } : row));
      return [...r, { time: formatTime(t), label: '' }];
    });
  };

  const save = () => {
    const out = [];
    for (const row of rows) {
      if (!row.time.trim() && !row.label.trim()) continue;
      const seconds = parseTime(row.time);
      if (seconds === null) return setError(`“${row.time || '(blank)'}” isn’t a time we can read. Try 2:10 or 1:02:15.`);
      out.push({ seconds, label: row.label.trim() });
    }
    out.sort((a, b) => a.seconds - b.seconds);
    onSave(out);
  };

  const first = rows.map((r) => parseTime(r.time)).filter((s) => s !== null).sort((a, b) => a - b)[0];

  return (
    <Modal title="Where’s the idea in this video?" eyebrow="YouTube timestamps" onClose={onClose} wide>
      <p className="muted">
        Point people straight to the moment that sparked your idea. We’ll link right to it — add as many moments as
        you like.
      </p>
      <div className="yt-frame">
        <div ref={holder} />
      </div>
      <div className="ts-rows">
        {rows.map((row, i) => (
          <div className="ts-row" key={i}>
            <label className="field ts-time">
              <span>Time</span>
              <input
                value={row.time}
                placeholder="2:10"
                inputMode="numeric"
                onChange={(e) => update(i, { time: e.target.value })}
              />
            </label>
            <label className="field ts-label">
              <span>What happens here? (optional)</span>
              <input
                value={row.label}
                placeholder="e.g. The stage design reveal"
                maxLength={120}
                onChange={(e) => update(i, { label: e.target.value })}
              />
            </label>
            <button
              className="icon-btn"
              aria-label="Remove timestamp"
              onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : [{ time: '', label: '' }]))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="ts-tools">
        <button className="btn btn-ghost btn-sm" onClick={() => setRows((r) => [...r, { time: '', label: '' }])}>
          <Plus size={15} /> Add another moment
        </button>
        <button className="btn btn-ghost btn-sm" onClick={grab} disabled={!playerReady}>
          <Clock size={15} /> Use the video’s current time
        </button>
      </div>
      {first !== undefined && (
        <p className="resolved-preview">
          Link will open at <code>…watch?v={videoId}&amp;t={first}</code>
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => onSave([])}>
          Skip — link the whole video
        </button>
        <button className="btn btn-primary" onClick={save}>
          Save moments
        </button>
      </div>
    </Modal>
  );
}
