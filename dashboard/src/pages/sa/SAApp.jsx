import React, { createContext, useContext, useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Bot, Building2, Users, LogOut, Loader2 } from 'lucide-react';
import api from '../../api';

const SALogin    = lazy(() => import('./SALogin'));
const SAGuilds   = lazy(() => import('./SAGuilds'));
const SAManagers = lazy(() => import('./SAManagers'));

function PageLoader() {
  return (
    <div className="flex h-full min-h-screen items-center justify-center">
      <Loader2 size={22} className="animate-spin text-red-400" />
    </div>
  );
}

const SACtx = createContext(null);
export const useSA = () => useContext(SACtx);

function RequireSA({ children }) {
  const { saUser, loading } = useSA();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!saUser) return <Navigate to="/sa/login" state={{ from: location }} replace />;
  return children;
}

function SALayout({ children }) {
  const { saUser, logout } = useSA();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/sa/login');
  };

  const nav = [
    { to: '/sa/guilds',   label: 'Serveurs',  icon: Building2 },
    ...(saUser?.type === 'superadmin' ? [{ to: '/sa/managers', label: 'Managers', icon: Users }] : [])
  ];

  return (
    <div className="flex h-screen bg-base text-ink-1 overflow-hidden">
      <aside className="w-52 flex-shrink-0 flex flex-col glass-dark border-r border-white/[0.06]">

        <div className="flex items-center gap-3 px-4 py-4 border-b border-white/[0.06]">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-red-500 to-orange-600
                          flex items-center justify-center shadow-lg shadow-red-500/30">
            <Bot size={15} className="text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-ink-1 leading-tight">Super Admin</p>
            <p className="text-[9px] text-red-400/60 font-semibold uppercase tracking-[0.15em]">Panel</p>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}>
              {({ isActive }) => (
                <span className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl
                                 text-sm font-medium transition-all duration-150 cursor-pointer
                                 ${isActive
                                   ? 'bg-red-500/10 text-red-200'
                                   : 'text-ink-3 hover:text-ink-2 hover:bg-white/[0.04]'}`}>
                  {isActive && (
                    <span className="absolute left-0 h-5 w-[3px] bg-red-500 rounded-r-full
                                     shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                  )}
                  <Icon size={15} className={`flex-shrink-0 ${isActive ? 'text-red-400' : 'text-ink-4'}`} />
                  <span>{label}</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-2 pb-3 pt-2 border-t border-white/[0.06]">
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl
                          bg-white/[0.03] border border-white/[0.05]">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-red-500 to-orange-600
                            flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {saUser?.username?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-ink-1 truncate leading-tight">{saUser?.username}</p>
              <p className="text-[10px] text-ink-4 capitalize">
                {saUser?.type === 'superadmin' ? 'Super Admin' : 'Manager'}
              </p>
            </div>
            <button
              onClick={handleLogout}
              title="Déconnexion"
              className="text-ink-4 hover:text-red-400 hover:bg-red-400/10 p-1 rounded-lg transition-all"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto min-w-0">
        <Suspense fallback={<PageLoader />}>{children}</Suspense>
      </main>
    </div>
  );
}

export default function SAApp() {
  const [saUser, setSaUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/sa/auth/me')
      .then(r => setSaUser(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await api.post('/sa/auth/logout').catch(() => {});
    setSaUser(null);
  };

  return (
    <SACtx.Provider value={{ saUser, setSaUser, loading, logout }}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="login" element={<SALogin />} />
          <Route path="guilds" element={
            <RequireSA><SALayout><SAGuilds /></SALayout></RequireSA>
          } />
          <Route path="managers" element={
            <RequireSA><SALayout><SAManagers /></SALayout></RequireSA>
          } />
          <Route index element={<Navigate to="/sa/guilds" replace />} />
          <Route path="*" element={<Navigate to="/sa/guilds" replace />} />
        </Routes>
      </Suspense>
    </SACtx.Provider>
  );
}
