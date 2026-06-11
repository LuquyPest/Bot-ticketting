import React, { createContext, useContext, useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import api from './api';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import { SSEProvider } from './context/SSEContext';
import { NotificationProvider } from './context/NotificationContext';
import { ThemeProvider } from './context/ThemeContext';

const SAApp       = lazy(() => import('./pages/sa/SAApp'));
const Login       = lazy(() => import('./pages/Login'));
const Pending     = lazy(() => import('./pages/Pending'));
const GuildSelect = lazy(() => import('./pages/GuildSelect'));
const Dashboard   = lazy(() => import('./pages/Dashboard'));
const Tickets     = lazy(() => import('./pages/Tickets'));
const TicketDetail = lazy(() => import('./pages/TicketDetail'));
const Staff       = lazy(() => import('./pages/Staff'));
const Blacklist   = lazy(() => import('./pages/Blacklist'));
const Transcripts = lazy(() => import('./pages/Transcripts'));
const Settings    = lazy(() => import('./pages/Settings'));
const Patchnotes  = lazy(() => import('./pages/Patchnotes'));
const Grades      = lazy(() => import('./pages/Grades'));
const Audit       = lazy(() => import('./pages/Audit'));
const Kanban      = lazy(() => import('./pages/Kanban'));
const Equipe      = lazy(() => import('./pages/Equipe'));
const Tags        = lazy(() => import('./pages/Tags'));
const StaffRoles  = lazy(() => import('./pages/StaffRoles'));
const TotpVerify  = lazy(() => import('./pages/TotpVerify'));
const Profile     = lazy(() => import('./pages/Profile'));

function PageLoader() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center p-12">
      <div className="animate-spin w-7 h-7 border-2 border-primary/40 border-t-primary rounded-full" />
    </div>
  );
}

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-base">
      <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  // User came through OAuth but has 2FA enabled — must verify before accessing dashboard
  if (user.needsTotp && location.pathname !== '/totp-verify') {
    return <Navigate to="/totp-verify" replace />;
  }

  if (!user.needsTotp) {
    // No guild selected yet (multiple guilds, needs to pick one)
    if (!user.guildId && location.pathname !== '/select-guild' && location.pathname !== '/pending') {
      return <Navigate to="/select-guild" replace />;
    }

    // Guild selected but user is pending approval
    if (user.role === 'nouveau' && location.pathname !== '/pending') {
      return <Navigate to="/pending" replace />;
    }
  }

  return children;
}

function RequireRole({ role, perm, children }) {
  const { user } = useAuth();
  if (user?.role === 'fondateur') return children;
  if (perm && user?.permissions?.includes(perm)) return children;
  const roles = Array.isArray(role) ? role : [role];
  if (!roles.includes(user?.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const [user,        setUser]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    api.get('/auth/me')
      .then(r => setUser(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  const selectGuild = async (guildId) => {
    await api.post('/auth/select-guild', { guildId });
    // Full reload — clears all guild-specific cached state
    window.location.href = '/';
  };

  return (
    <ThemeProvider>
    <AuthCtx.Provider value={{ user, setUser, loading, logout, selectGuild, sidebarOpen, setSidebarOpen }}>
      <SSEProvider>
        <NotificationProvider>
          <Routes>
            <Route path="/sa/*" element={
              <Suspense fallback={<PageLoader />}>
                <ErrorBoundary><SAApp /></ErrorBoundary>
              </Suspense>
            } />
            <Route path="/login" element={
              <Suspense fallback={<PageLoader />}>
                <ErrorBoundary><Login /></ErrorBoundary>
              </Suspense>
            } />
            <Route path="/totp-verify" element={
              <RequireAuth>
                <Suspense fallback={<PageLoader />}>
                  <ErrorBoundary><TotpVerify /></ErrorBoundary>
                </Suspense>
              </RequireAuth>
            } />
            <Route path="/pending" element={
              <RequireAuth>
                <Suspense fallback={<PageLoader />}>
                  <ErrorBoundary><Pending /></ErrorBoundary>
                </Suspense>
              </RequireAuth>
            } />
            <Route path="/select-guild" element={
              <RequireAuth>
                <Suspense fallback={<PageLoader />}>
                  <ErrorBoundary><GuildSelect /></ErrorBoundary>
                </Suspense>
              </RequireAuth>
            } />
            <Route path="/*" element={
              <RequireAuth>
                <div className="flex h-screen bg-base text-ink-1 overflow-hidden">
                  <Sidebar />
                  {sidebarOpen && (
                    <div
                      className="fixed inset-0 bg-black/60 z-30 lg:hidden"
                      onClick={() => setSidebarOpen(false)}
                    />
                  )}
                  <main className="flex-1 overflow-y-auto min-w-0 pt-10 lg:pt-0">
                    <Suspense fallback={<PageLoader />}>
                      <Routes>
                        <Route index element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
                        <Route path="tickets"    element={<ErrorBoundary><Tickets /></ErrorBoundary>} />
                        <Route path="tickets/:id" element={<ErrorBoundary><TicketDetail /></ErrorBoundary>} />
                        <Route path="staff"      element={<ErrorBoundary><Staff /></ErrorBoundary>} />
                        <Route path="blacklist"  element={
                          <RequireRole role="fondateur"><ErrorBoundary><Blacklist /></ErrorBoundary></RequireRole>
                        } />
                        <Route path="transcripts" element={
                          <RequireRole role="fondateur"><ErrorBoundary><Transcripts /></ErrorBoundary></RequireRole>
                        } />
                        <Route path="settings"   element={
                          <RequireRole role="fondateur"><ErrorBoundary><Settings /></ErrorBoundary></RequireRole>
                        } />
                        <Route path="staff-roles" element={
                          <RequireRole role="fondateur"><ErrorBoundary><StaffRoles /></ErrorBoundary></RequireRole>
                        } />
                        <Route path="equipe"     element={
                          <RequireRole role="fondateur"><ErrorBoundary><Equipe /></ErrorBoundary></RequireRole>
                        } />
                        <Route path="tags"       element={
                          <RequireRole role="fondateur"><ErrorBoundary><Tags /></ErrorBoundary></RequireRole>
                        } />
                        <Route path="grades"     element={
                          <RequireRole role="fondateur" perm="manage_grades"><ErrorBoundary><Grades /></ErrorBoundary></RequireRole>
                        } />
                        <Route path="audit"      element={
                          <RequireRole role="fondateur" perm="view_audit"><ErrorBoundary><Audit /></ErrorBoundary></RequireRole>
                        } />
                        <Route path="kanban"     element={<ErrorBoundary><Kanban /></ErrorBoundary>} />
                        <Route path="profile"    element={<ErrorBoundary><Profile /></ErrorBoundary>} />
                        <Route path="patchnotes" element={
                          <RequireRole role="fondateur"><ErrorBoundary><Patchnotes /></ErrorBoundary></RequireRole>
                        } />
                      </Routes>
                    </Suspense>
                  </main>
                </div>
              </RequireAuth>
            } />
          </Routes>
        </NotificationProvider>
      </SSEProvider>
    </AuthCtx.Provider>
    </ThemeProvider>
  );
}
