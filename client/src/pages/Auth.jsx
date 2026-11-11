import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { NDMark, Streaks } from '../components/Brand.jsx';

function AuthShell({ title, sub, children }) {
  return (
    <div className="auth-page">
      <div className="auth-art">
        <Streaks variant="diagonal" />
        <div className="auth-art-inner">
          <NDMark className="auth-mark" />
          <p className="auth-quote">
            “Where there is no vision, the people perish.”
            <span>Proverbs 29:18</span>
          </p>
        </div>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-card">
          <p className="eyebrow">Idea Library</p>
          <h1>{title}</h1>
          <p className="muted">{sub}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function useAfterAuth() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const next = params.get('next');
  return () => nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

export function Login() {
  const { setUser } = useAuth();
  const done = useAfterAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api.post('/auth/login', form);
      setUser(user);
      done();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Welcome back." sub="Sign in to share, vote, and join the conversation.">
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-lg w-full" disabled={busy}>Sign in</button>
        <p className="muted center">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function Register() {
  const { setUser } = useAuth();
  const done = useAfterAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api.post('/auth/register', form);
      setUser(user);
      done();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Join the library." sub="One account lets you share ideas, vote, and comment.">
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Your name</span>
          <input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={60} />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <label className="field">
          <span>Password <em className="muted">(8+ characters)</em></span>
          <input type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-lg w-full" disabled={busy}>Create account</button>
        <p className="muted center">
          Already have one? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
