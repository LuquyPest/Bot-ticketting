import React, { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import api from './api';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Pending from './pages/Pending';
import Dashboard from './pages/Dashboard';
import Tickets from './pages/Tickets';
import TicketDetail from './pages/TicketDetail';
import Staff from './pages/Staff';
import Blacklist from './pages/Blacklist';
import Transcripts from './pages/Transcripts';
import Settings from './pages/Settings';
import Users from './pages/Users';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
    </div>
  );
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.role === 'nouveau' && location.pathname !== '/pending') {
    return <Navigate to="/pending" replace />;
  }
  return children;
}

function RequireRole({ role, children }) {
  const { user } = useAuth();
  const roles = Array.isArray(role) ? role : [role];
  if (!roles.includes(user?.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/auth/me').then(r => setUser(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, setUser, loading, logout }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/pending" element={
          <RequireAuth><Pending /></RequireAuth>
        } />
        <Route path="/*" element={
          <RequireAuth>
            <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
              <Sidebar />
              <main className="flex-1 overflow-y-auto">
                <Routes>
                  <Route index element={<Dashboard />} />
                  <Route path="tickets" element={<Tickets />} />
                  <Route path="tickets/:id" element={<TicketDetail />} />
                  <Route path="staff" element={<Staff />} />
                  <Route path="blacklist" element={
                    <RequireRole role="fondateur"><Blacklist /></RequireRole>
                  } />
                  <Route path="transcripts" element={
                    <RequireRole role="fondateur"><Transcripts /></RequireRole>
                  } />
                  <Route path="settings" element={
                    <RequireRole role="fondateur"><Settings /></RequireRole>
                  } />
                  <Route path="users" element={
                    <RequireRole role="fondateur"><Users /></RequireRole>
                  } />
                </Routes>
              </main>
            </div>
          </RequireAuth>
        } />
      </Routes>
    </AuthCtx.Provider>
  );
}
