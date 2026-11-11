import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import IdeaCard from '../components/IdeaCard.jsx';
import { Spinner } from '../components/bits.jsx';

function Settings() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const save = async (body) => {
    setMsg('');
    setError('');
    try {
      const { user: u } = await api.patch('/auth/me', body);
      setUser(u);
      setMsg('Saved.');
      setPw({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="side-card">
      <p className="eyebrow">Your account</p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save({ name }); }}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <button className="btn btn-ghost btn-sm" disabled={name === user.name}>Update name</button>
      </form>
      <hr />
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(pw); }}>
        <label className="field">
          <span>Current password</span>
          <input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        </label>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
        </label>
        <button className="btn btn-ghost btn-sm" disabled={!pw.currentPassword || pw.newPassword.length < 8}>Change password</button>
      </form>
      {msg && <p className="form-ok">{msg}</p>}
      {error && <p className="form-error">{error}</p>}
      <p className="muted small">{user.email}</p>
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/ideas?mine=1&sort=new').then(setData);
  }, []);
  return (
    <div className="container profile">
      <div className="form-head">
        <p className="eyebrow">My ideas</p>
        <h1>Hey {user.name.split(' ')[0]}.</h1>
        <p className="muted">Everything you’ve shared, and where it stands.</p>
      </div>
      <div className="profile-grid">
        <div>
          {!data ? (
            <Spinner />
          ) : data.ideas.length === 0 ? (
            <div className="empty-state left">
              <h2>You haven’t shared an idea yet.</h2>
              <p className="muted">It doesn’t have to be polished. Get it out of your head and into the library.</p>
              <Link className="btn btn-primary" to="/ideas/new"><Plus size={16} /> Share an idea</Link>
            </div>
          ) : (
            <div className="idea-grid two">
              {data.ideas.map((i) => <IdeaCard key={i.id} idea={i} />)}
            </div>
          )}
        </div>
        <Settings />
      </div>
    </div>
  );
}
