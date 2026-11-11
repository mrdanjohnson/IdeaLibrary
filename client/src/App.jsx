import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import Header from './components/Header.jsx';
import Footer from './components/Footer.jsx';
import Library from './pages/Library.jsx';
import IdeaDetail from './pages/IdeaDetail.jsx';
import IdeaForm from './pages/IdeaForm.jsx';
import { Login, Register } from './pages/Auth.jsx';
import Roadmap from './pages/Roadmap.jsx';
import Profile from './pages/Profile.jsx';
import Admin from './pages/Admin.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const CategoryContext = createContext(null);
export const useCategories = () => useContext(CategoryContext);

function RequireUser({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return children;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [categories, setCategories] = useState([]);
  const { pathname } = useLocation();

  const refreshCategories = useCallback(
    () => api.get('/categories').then((d) => setCategories(d.categories)),
    [],
  );

  useEffect(() => {
    api.get('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
    refreshCategories();
  }, [refreshCategories]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (user === undefined) return <div className="boot" aria-busy="true" />;

  const isStaff = !!user && (user.role === 'admin' || user.leadCategoryIds.length > 0);

  return (
    <AuthContext.Provider value={{ user, setUser, isStaff }}>
      <CategoryContext.Provider value={{ categories, refreshCategories }}>
        <Header />
        <main className="main">
          <Routes>
            <Route path="/" element={<Library />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/ideas/new" element={<RequireUser><IdeaForm /></RequireUser>} />
            <Route path="/ideas/:id" element={<IdeaDetail />} />
            <Route path="/ideas/:id/edit" element={<RequireUser><IdeaForm /></RequireUser>} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/me" element={<RequireUser><Profile /></RequireUser>} />
            <Route path="/admin/*" element={<RequireUser>{isStaff ? <Admin /> : <Navigate to="/" />}</RequireUser>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </CategoryContext.Provider>
    </AuthContext.Provider>
  );
}

function NotFound() {
  return (
    <div className="container empty-state" style={{ paddingTop: 80 }}>
      <p className="eyebrow">404</p>
      <h1>This page wandered off.</h1>
      <a className="btn btn-primary" href="/">Back to the library</a>
    </div>
  );
}
