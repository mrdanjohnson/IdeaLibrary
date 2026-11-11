import { ND_PATH } from '../ndPath.js';

/** The ND mark, drawn from the brand guide's vector. Color comes from CSS (gray, or white on dark). */
export function NDMark({ className = '', title = 'New Day Church' }) {
  return (
    <svg className={`nd-mark ${className}`} viewBox="0 0 89.54 45.52" role="img" aria-label={title}>
      <path fill="currentColor" d={ND_PATH} />
    </svg>
  );
}

/** Secondary lockup: mark + "newday" regular + "church" bold, then the product name. */
export function Logo({ onDark = false }) {
  return (
    <span className={`logo ${onDark ? 'logo-on-dark' : ''}`}>
      <NDMark />
      <span className="wordmark">
        newday<b>church</b>
      </span>
      <span className="logo-rule" aria-hidden="true" />
      <span className="logo-product">Idea Library</span>
    </span>
  );
}

/**
 * The rounded "streak" pattern from the brand gradients page.
 * `variant` picks the horizontal or diagonal layout.
 */
export function Streaks({ variant = 'horizontal', className = '' }) {
  const rows =
    variant === 'diagonal'
      ? [
          [8, 30, 70], [22, 48, 52], [40, 12, 64], [58, 36, 48], [74, 6, 78], [90, 44, 40],
        ]
      : [
          [6, -10, 52], [20, 20, 64], [34, -6, 42], [48, 30, 58], [62, -12, 70], [76, 18, 46], [90, -4, 60],
        ];
  return (
    <div className={`streaks streaks-${variant} ${className}`} aria-hidden="true">
      {rows.map(([top, left, width], i) => (
        <span key={i} style={{ top: `${top}%`, left: `${left}%`, width: `${width}%`, animationDelay: `${i * -2.3}s` }} />
      ))}
    </div>
  );
}
