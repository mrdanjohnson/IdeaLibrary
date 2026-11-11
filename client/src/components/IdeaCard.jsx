import { Link } from 'react-router-dom';
import { CalendarDays, Link2, MessageCircle, PlayCircle } from 'lucide-react';
import { CategoryTag, PassionMeter, StatusBadge, VoteControl } from './bits.jsx';
import { formatDate, hostname, timeAgo } from '../constants.js';

/** No thumbnail? Paint the brand streaks in the idea's category color instead. */
export function ThumbFallback({ color, title }) {
  const seed = [...title].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rows = [0, 1, 2, 3, 4].map((i) => {
    const r = (seed * (i + 3)) % 97;
    return { top: 8 + i * 19, left: -20 + (r % 40), width: 45 + (r % 45) };
  });
  return (
    <div className="thumb-fallback" style={{ '--c': color }} aria-hidden="true">
      {rows.map((r, i) => (
        <span key={i} style={{ top: `${r.top}%`, left: `${r.left}%`, width: `${r.width}%` }} />
      ))}
    </div>
  );
}

export default function IdeaCard({ idea, style }) {
  return (
    <article className="idea-card" style={{ ...style, '--c': idea.category.color }}>
      <Link to={`/ideas/${idea.id}`} className="card-link" aria-label={idea.title} />
      <div className="card-media">
        {idea.thumbnail ? (
          <img src={idea.thumbnail} alt="" loading="lazy" />
        ) : (
          <ThumbFallback color={idea.category.color} title={idea.title} />
        )}
        {idea.youtubeId && (
          <span className="media-chip">
            <PlayCircle size={14} /> Video
          </span>
        )}
        {!idea.youtubeId && idea.url && (
          <span className="media-chip">
            <Link2 size={14} /> {hostname(idea.url)}
          </span>
        )}
        <div className="card-status">
          <StatusBadge status={idea.status} size="sm" />
        </div>
      </div>
      <div className="card-body">
        <div className="card-top">
          <CategoryTag category={idea.category} />
          {idea.scheduledFor && ['scheduled', 'in_progress'].includes(idea.status) && (
            <span className="card-date">
              <CalendarDays size={13} /> {formatDate(idea.scheduledFor)}
            </span>
          )}
        </div>
        <h3 className="card-title">{idea.title}</h3>
        <p className="card-desc">{idea.description}</p>
        <PassionMeter rating={idea.rating} compact />
        <div className="card-foot">
          <span className="card-meta">
            {idea.author ? idea.author.name : 'Anonymous'} · {timeAgo(idea.createdAt)}
          </span>
          <span className="card-meta comments">
            <MessageCircle size={14} /> {idea.commentCount}
          </span>
          <VoteControl idea={idea} horizontal />
        </div>
      </div>
    </article>
  );
}
