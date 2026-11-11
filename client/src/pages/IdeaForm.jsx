import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Clock, EyeOff, ImageOff, Lightbulb, Pencil, Plus, Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { useCategories } from '../App.jsx';
import TimestampDialog from '../components/TimestampDialog.jsx';
import { Spinner, StatusBadge } from '../components/bits.jsx';
import { RATINGS, formatTime, youtubeId } from '../constants.js';

function CategoryPicker({ value, onChange }) {
  const { categories, refreshCategories } = useCategories();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const add = async () => {
    setError('');
    try {
      const { category } = await api.post('/categories', { name });
      await refreshCategories();
      onChange(category.id);
      setAdding(false);
      setName('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="cat-choices" role="radiogroup" aria-label="Category">
        {categories.map((c) => (
          <button
            type="button"
            role="radio"
            aria-checked={value === c.id}
            key={c.id}
            className={`cat-choice ${value === c.id ? 'active' : ''}`}
            style={{ '--c': c.color }}
            onClick={() => onChange(c.id)}
            title={c.description}
          >
            <span className="cat-swatch" /> {c.name}
          </button>
        ))}
        {!adding && (
          <button type="button" className="cat-choice add" onClick={() => setAdding(true)}>
            <Plus size={14} /> New category
          </button>
        )}
      </div>
      {adding && (
        <div className="inline-add">
          <input
            autoFocus
            value={name}
            maxLength={40}
            placeholder="e.g. Prayer Team"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={name.trim().length < 2}>
            Add
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function RatingPicker({ value, onChange }) {
  return (
    <div className="rating-picker" role="radiogroup" aria-label="Passion rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          role="radio"
          aria-checked={value === n}
          className={`rating-opt ${value === n ? 'active' : ''} ${value >= n ? 'filled' : ''}`}
          onClick={() => onChange(n)}
          style={{ '--i': n }}
        >
          <span className="rating-bar" />
          <span className="rating-num">{n}</span>
          <span className="rating-text">{RATINGS[n]}</span>
        </button>
      ))}
    </div>
  );
}

const EMPTY = { title: '', description: '', url: '', categoryId: null, source: '', rating: 3, anonymous: false, timestamps: [] };

export default function IdeaForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [loaded, setLoaded] = useState(!editing);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [similar, setSimilar] = useState([]);
  const [tsOpen, setTsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const promptedFor = useRef(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const vid = youtubeId(form.url.trim());

  useEffect(() => {
    if (!editing) return;
    api.get(`/ideas/${id}`).then(({ idea }) => {
      if (!idea.canEdit) return nav(`/ideas/${id}`);
      setForm({
        title: idea.title,
        description: idea.description,
        url: idea.url || '',
        categoryId: idea.category.id,
        source: idea.source,
        rating: idea.rating,
        anonymous: idea.anonymous,
        timestamps: idea.timestamps.map(({ seconds, label }) => ({ seconds, label })),
      });
      promptedFor.current = youtubeId(idea.url || '');
      setLoaded(true);
    });
  }, [editing, id, nav]);

  // Pop the timestamp dialog the first time a new YouTube video is pasted.
  useEffect(() => {
    if (loaded && vid && promptedFor.current !== vid) {
      promptedFor.current = vid;
      setTsOpen(true);
    }
    if (!vid) set({ timestamps: [] });
  }, [vid, loaded]);

  // Live link preview (thumbnail) as people type a URL.
  useEffect(() => {
    const url = form.url.trim();
    setPreview(null);
    if (!/^https?:\/\/\S+\.\S+/.test(url)) return;
    setPreviewing(true);
    const t = setTimeout(() => {
      api
        .get(`/link-preview?url=${encodeURIComponent(url)}`)
        .then((p) => {
          setPreview(p);
          if (!form.title.trim() && p.title && !editing) set({ title: p.title.slice(0, 120) });
        })
        .finally(() => setPreviewing(false));
    }, 600);
    return () => {
      clearTimeout(t);
      setPreviewing(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.url]);

  // "Has someone already shared this?" check on the title.
  useEffect(() => {
    if (form.title.trim().length < 6) return setSimilar([]);
    const t = setTimeout(() => {
      api.get(`/ideas/similar?title=${encodeURIComponent(form.title)}&exclude=${id || 0}`).then((d) => setSimilar(d.ideas));
    }, 400);
    return () => clearTimeout(t);
  }, [form.title, id]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.categoryId) return setError('Pick a category so the right team sees it.');
    setSaving(true);
    try {
      const { idea } = editing ? await api.patch(`/ideas/${id}`, form) : await api.post('/ideas', form);
      nav(`/ideas/${idea.id}`, { state: { justSaved: !editing } });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  if (!loaded) return <div className="center-pad"><Spinner /></div>;

  return (
    <div className="container form-page">
      <div className="form-head">
        <p className="eyebrow">{editing ? 'Edit your idea' : 'Share an idea'}</p>
        <h1>{editing ? 'Make it even better.' : 'What’s on your heart?'}</h1>
        <p className="muted">Clear beats clever. Tell us the what, and if you can, the why.</p>
      </div>

      <form className="idea-form" onSubmit={submit}>
        <div className="form-main">
          <label className="field">
            <span>Idea title</span>
            <input
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="e.g. Testimony night between worship sets"
              maxLength={120}
              required
            />
          </label>

          {similar.length > 0 && (
            <div className="similar-box">
              <p>
                <Sparkles size={15} /> <strong>Similar ideas already in the library.</strong> If one of these is yours,
                vote and comment there so the ideas grow together.
              </p>
              <ul>
                {similar.map((s) => (
                  <li key={s.id}>
                    <Link to={`/ideas/${s.id}`} target="_blank">{s.title}</Link>
                    <span className="muted"> · {s.category} · {s.score} votes</span> <StatusBadge status={s.status} size="sm" />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="field">
            <span>Describe it</span>
            <textarea
              rows={7}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="What would it look like? Who would it help? Why now?"
              maxLength={5000}
              required
            />
          </label>

          <label className="field">
            <span>Link <em className="muted">(optional — a website, video, or post that inspired this)</em></span>
            <input
              type="url"
              value={form.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://"
            />
          </label>

          {vid && (
            <div className="ts-summary">
              <div>
                <strong>YouTube moments</strong>
                {form.timestamps.length ? (
                  <ul className="ts-chips">
                    {form.timestamps.map((t, i) => (
                      <li key={i}>
                        <Clock size={13} /> {formatTime(t.seconds)} {t.label && <span className="muted">— {t.label}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Linking to the whole video.</p>
                )}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTsOpen(true)}>
                <Pencil size={14} /> {form.timestamps.length ? 'Edit moments' : 'Add moments'}
              </button>
            </div>
          )}

          <label className="field">
            <span>Where did this idea come from?</span>
            <input
              value={form.source}
              onChange={(e) => set({ source: e.target.value })}
              placeholder="e.g. Another church, a conference, a podcast, a dream at 2am"
              maxLength={160}
            />
          </label>

          <div className="field">
            <span>Category</span>
            <CategoryPicker value={form.categoryId} onChange={(categoryId) => set({ categoryId })} />
          </div>

          <div className="field">
            <span>How passionate are you about this?</span>
            <RatingPicker value={form.rating} onChange={(rating) => set({ rating })} />
          </div>

          <label className="toggle">
            <input type="checkbox" checked={form.anonymous} onChange={(e) => set({ anonymous: e.target.checked })} />
            <span className="toggle-track"><span /></span>
            <span>
              <EyeOff size={15} /> Share anonymously
              <small className="muted">Members won’t see your name. Admins still can, so they can follow up with you.</small>
            </span>
          </label>

          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => nav(-1)}>Cancel</button>
            <button className="btn btn-primary btn-lg" disabled={saving}>
              {saving ? <Spinner /> : <Lightbulb size={18} />} {editing ? 'Save changes' : 'Add to the library'}
            </button>
          </div>
        </div>

        <aside className="form-side">
          <div className="preview-card">
            <p className="eyebrow">Preview</p>
            <div className="preview-media">
              {previewing ? (
                <Spinner />
              ) : preview?.image ? (
                <img src={preview.image} alt="" referrerPolicy="no-referrer" />
              ) : (
                <div className="preview-empty">
                  <ImageOff size={26} />
                  <span>{form.url ? 'No preview image found — we’ll use a color card.' : 'Add a link and we’ll grab a thumbnail automatically.'}</span>
                </div>
              )}
            </div>
            <h3>{form.title || 'Your idea title'}</h3>
            <p className="muted">{form.description.slice(0, 140) || 'Your description will show up here.'}</p>
          </div>
          <div className="tips">
            <p className="eyebrow">Tips</p>
            <ul>
              <li>Lead with the most important thing.</li>
              <li>Say who it helps — kids, guests, volunteers?</li>
              <li>A link or video makes it easy to picture.</li>
            </ul>
          </div>
        </aside>
      </form>

      {tsOpen && vid && (
        <TimestampDialog
          videoId={vid}
          initial={form.timestamps}
          onClose={() => setTsOpen(false)}
          onSave={(timestamps) => {
            set({ timestamps });
            setTsOpen(false);
          }}
        />
      )}
    </div>
  );
}
