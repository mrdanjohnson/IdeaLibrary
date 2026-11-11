import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu, Plus, Settings, Shield, User, X } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { Logo } from './Brand.jsx';
import { timeAgo } from '../constants.js';

function useClickAway(ref, onAway) {
  useEffect(() => {
    const fn = (e) => ref.current && !ref.current.contains(e.target) && onAway();
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [ref, onAway]);
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ notifications: [], unread: 0 });
  const ref = useRef(null);
  const nav = useNavigate();
  useClickAway(ref, () => setOpen(false));

  const load = () => api.get('/notifications').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read_at) await api.post('/notifications/read', { ids: [n.id] });
    load();
    if (n.idea_id) nav(`/ideas/${n.idea_id}`);
  };

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className="icon-btn"
        aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ''}`}
        onClick={() => {
          setOpen(!open);
          if (!open) load();
        }}
      >
        <Bell size={20} />
        {data.unread > 0 && <span className="badge-dot">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="popover notif-popover">
          <div className="popover-head">
            <span className="eyebrow">Updates</span>
            {data.unread > 0 && (
              <button className="link-btn" onClick={() => api.post('/notifications/read').then(load)}>
                Mark all read
              </button>
            )}
          </div>
          {data.notifications.length === 0 ? (
            <p className="muted notif-empty">You’re all caught up. When leadership responds to your ideas, you’ll see it here.</p>
          ) : (
            <ul className="notif-list">
              {data.notifications.map((n) => (
                <li key={n.id}>
                  <button className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => openItem(n)}>
                    <span className={`notif-type t-${n.type}`} />
                    <span>
                      <span className="notif-msg">{n.message}</span>
                      <span className="notif-time">{timeAgo(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, setUser, isStaff } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const nav = useNavigate();
  useClickAway(ref, () => setOpen(false));
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="popover-anchor" ref={ref}>
      <button className="avatar-btn" onClick={() => setOpen(!open)} aria-label="Account menu">
        <span className="avatar">{initials}</span>
      </button>
      {open && (
        <div className="popover menu-popover" onClick={() => setOpen(false)}>
          <div className="menu-who">
            <strong>{user.name}</strong>
            <span className="muted">{user.role === 'admin' ? 'Admin' : isStaff ? 'Category lead' : 'Member'}</span>
          </div>
          <Link to="/me" className="menu-item"><User size={16} /> My ideas & settings</Link>
          {isStaff && <Link to="/admin" className="menu-item"><Shield size={16} /> Leadership dashboard</Link>}
          {user.role === 'admin' && <Link to="/admin/categories" className="menu-item"><Settings size={16} /> Manage categories</Link>}
          <button
            className="menu-item"
            onClick={async () => {
              await api.post('/auth/logout');
              setUser(null);
              nav('/');
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link to="/" className="brand-link" aria-label="Idea Library home">
          <Logo />
        </Link>
        <nav className={`main-nav ${mobileOpen ? 'open' : ''}`} onClick={() => setMobileOpen(false)}>
          <NavLink to="/" end>Library</NavLink>
          <NavLink to="/roadmap">What’s Happening</NavLink>
          {user && <NavLink to="/me">My Ideas</NavLink>}
        </nav>
        <div className="header-actions">
          {user ? (
            <>
              <Link to="/ideas/new" className="btn btn-primary btn-sm hide-xs">
                <Plus size={16} /> Share an idea
              </Link>
              <Notifications />
              <UserMenu />
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
              <Link to="/register" className="btn btn-primary btn-sm">Join</Link>
            </>
          )}
          <button className="icon-btn nav-toggle" aria-label="Menu" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
    </header>
  );
}
