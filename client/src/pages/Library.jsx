import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lightbulb, Plus, Search } from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth, useCategories } from '../App.jsx';
import { Streaks } from '../components/Brand.jsx';
import IdeaCard from '../components/IdeaCard.jsx';
import { Spinner } from '../components/bits.jsx';
import { SORTS, STATUSES, STATUS_ORDER } from '../constants.js';

export default function Library() {
  const { user } = useAuth();
  const { categories } = useCategories();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [q, setQ] = useState(params.get('q') || '');

  const filters = useMemo(
    () => ({
      category: params.get('category') || '',
      status: params.get('status') || '',
      sort: params.get('sort') || 'trending',
      q: params.get('q') || '',
      page: params.get('page') || '',
    }),
    [params],
  );

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(() => q !== filters.q && set('q', q.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    let live = true;
    setData((d) => (d ? { ...d, loading: true } : null));
    api.get(`/ideas${qs(filters)}`).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [filters]);

  const activeCats = categories.filter((c) => c.idea_count > 0 || String(c.id) === filters.category);

  return (
    <>
      <section className="hero">
        <Streaks />
        <div className="container hero-inner">
          <p className="eyebrow on-dark">New Day Church · Idea Library</p>
          <h1 className="hero-title">
            Big ideas start
            <br />
            <span className="hero-accent">right here.</span>
          </h1>
          <p className="hero-sub">
            Share what God’s put on your heart for our church. Vote on the ideas that move you, join the conversation,
            and watch leadership bring them to life.
          </p>
          <div className="hero-actions">
            <Link to={user ? '/ideas/new' : '/register'} className="btn btn-light btn-lg">
              <Plus size={18} /> {user ? 'Share an idea' : 'Join & share an idea'}
            </Link>
            <Link to="/roadmap" className="btn btn-outline-light btn-lg">
              See what’s happening
            </Link>
          </div>
        </div>
      </section>

      <div className="container library">
        <div className="toolbar">
          <label className="search">
            <Search size={18} />
            <input
              type="search"
              placeholder="Search ideas, sources, descriptions…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search ideas"
            />
          </label>
          <select value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label="Filter by status">
            <option value="">Every status</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUSES[s].label}</option>
            ))}
          </select>
          <select value={filters.sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort ideas">
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div className="cat-filter" role="tablist" aria-label="Categories">
          <button role="tab" aria-selected={!filters.category} className={`cat-pill ${!filters.category ? 'active' : ''}`} onClick={() => set('category', '')}>
            All ideas
          </button>
          {activeCats.map((c) => (
            <button
              role="tab"
              aria-selected={filters.category === String(c.id)}
              key={c.id}
              className={`cat-pill ${filters.category === String(c.id) ? 'active' : ''}`}
              style={{ '--c': c.color }}
              onClick={() => set('category', filters.category === String(c.id) ? '' : String(c.id))}
            >
              <span className="cat-swatch" /> {c.name} <span className="cat-count">{c.idea_count}</span>
            </button>
          ))}
        </div>

        {!data ? (
          <div className="center-pad"><Spinner /></div>
        ) : data.ideas.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Lightbulb size={30} /></div>
            <h2>{filters.q || filters.category || filters.status ? 'Nothing matches that yet.' : 'The library is waiting for its first idea.'}</h2>
            <p className="muted">
              {filters.q || filters.category || filters.status
                ? 'Try a different search or filter — or be the first to share it.'
                : 'Every ministry moment we love started as someone’s idea. Yours could be next.'}
            </p>
            <Link to="/ideas/new" className="btn btn-primary"><Plus size={16} /> Share an idea</Link>
          </div>
        ) : (
          <>
            <p className="result-count muted">
              {data.total} idea{data.total === 1 ? '' : 's'}
            </p>
            <div className={`idea-grid ${data.loading ? 'is-loading' : ''}`}>
              {data.ideas.map((idea, i) => (
                <IdeaCard key={idea.id} idea={idea} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }} />
              ))}
            </div>
            {data.pages > 1 && (
              <div className="pager">
                <button className="btn btn-ghost" disabled={data.page <= 1} onClick={() => set('page', String(data.page - 1))}>Previous</button>
                <span className="muted">Page {data.page} of {data.pages}</span>
                <button className="btn btn-ghost" disabled={data.page >= data.pages} onClick={() => set('page', String(data.page + 1))}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
