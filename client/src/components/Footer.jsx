import { NDMark } from './Brand.jsx';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-band" aria-hidden="true" />
      <div className="container footer-inner">
        <NDMark className="footer-mark" />
        <p>
          Every great ministry moment started as someone’s idea.
          <br />
          <span className="muted">New Day Church · Idea Library</span>
        </p>
      </div>
    </footer>
  );
}
