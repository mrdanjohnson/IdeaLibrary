import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronUp, RotateCcw } from 'lucide-react';
import { api } from '../api.js';
import { Streaks } from '../components/Brand.jsx';
import { CategoryTag, Spinner } from '../components/bits.jsx';
import { STATUSES, formatDate } from '../constants.js';

const COLUMNS = ['under_review', 'scheduled', 'in_progress', 'done'];

/** A board that answers "is anyone actually looking at these?" */
export default function Roadmap() {
  const [cols, setCols] = useState(null);
  const [notNow, setNotNow] = useState([]);

  useEffect(() => {
    Promise.all([
      ...COLUMNS.map((s) => api.get(`/ideas?status=${s}&sort=${s === 'scheduled' ? 'new' : 'top'}`)),
      api.get('/ideas?status=not_now&sort=new'),
    ]).then((res) => {
      const out = {};
      COLUMNS.forEach((s, i) => {
        const ideas = res[i].ideas;
        if (s === 'scheduled') ideas.sort((a, b) => (a.scheduledFor || '9').localeCompare(b.scheduledFor || '9'));
        out[s] = ideas;
      });
      setCols(out);
      setNotNow(res[COLUMNS.length].ideas);
    });
  }, []);

  return (
    <>
      <section className="hero hero-compact">
        <Streaks />
        <div className="container hero-inner">
          <p className="eyebrow on-dark">What’s happening</p>
          <h1 className="hero-title">Ideas on the move.</h1>
          <p className="hero-sub">See which ideas leadership is considering, what’s on the calendar, and what’s already come to life.</p>
        </div>
      </section>
      <div className="container">
        {!cols ? (
          <div className="center-pad"><Spinner /></div>
        ) : (
          <>
            <div className="board">
              {COLUMNS.map((s) => (
                <section key={s} className="board-col" style={{ '--c': STATUSES[s].color }}>
                  <header>
                    <span className="status-dot" />
                    <h2>{STATUSES[s].label}</h2>
                    <span className="count">{cols[s].length}</span>
                  </header>
                  <p className="muted small">{STATUSES[s].blurb}</p>
                  {cols[s].length === 0 && <p className="board-empty">Nothing here yet.</p>}
                  {cols[s].map((idea) => (
                    <Link key={idea.id} to={`/ideas/${idea.id}`} className="board-card">
                      <CategoryTag category={idea.category} />
                      <strong>{idea.title}</strong>
                      <span className="board-meta">
                        <span><ChevronUp size={14} /> {idea.score}</span>
                        {idea.scheduledFor && <span><CalendarDays size={13} /> {formatDate(idea.scheduledFor)}</span>}
                      </span>
                    </Link>
                  ))}
                </section>
              ))}
            </div>
            {notNow.length > 0 && (
              <section className="not-now-section">
                <h2 className="section-title">Not right now <span className="count">{notNow.length}</span></h2>
                <p className="muted">Good ideas whose season hasn’t come yet — with the why behind each decision.</p>
                <div className="not-now-list">
                  {notNow.map((idea) => (
                    <Link key={idea.id} to={`/ideas/${idea.id}`} className="not-now-item">
                      <strong>{idea.title}</strong>
                      <CategoryTag category={idea.category} />
                      <RotateCcw size={14} className="muted" />
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
