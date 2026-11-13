import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, Link } from 'react-router-dom';
import { Server, Building2, Loader2, ShieldAlert, LayoutDashboard, Bug, ScrollText, HeartPulse, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../App';
import { useInstanceInfo } from '../../hooks/useInstanceInfo';

const Overview = lazy(() => import('./Overview'));
const Guilds   = lazy(() => import('./Guilds'));
const Health   = lazy(() => import('./Health'));
const Errors   = lazy(() => import('./Errors'));
const Journal  = lazy(() => import('./Journal'));
const Blocked  = lazy(() => import('./Blocked'));

// Instance section: reserved to the owner of the instance (owner of the Discord application or
// OWNER_IDS), reached from the dashboard with the same Discord sign-in.
const NAV = [
  { to: '/instance/overview', label: 'Vue d\'ensemble', icon: LayoutDashboard },
  { to: '/instance/guilds',   label: 'Serveurs', icon: Building2 },
  { to: '/instance/health',   label: 'Santé',    icon: HeartPulse },
  { to: '/instance/errors',   label: 'Erreurs',  icon: Bug },
  { to: '/instance/journal',  label: 'Journal',  icon: ScrollText },
  { to: '/instance/blocked',  label: 'Blocages', icon: ShieldAlert },
];

function PageLoader() {
  return (
    <div className="flex h-full min-h-screen items-center justify-center">
      <Loader2 size={22} className="animate-spin text-primary-light" />
    </div>
  );
}

function InstanceLayout({ children }) {
  const { user } = useAuth();
  const info = useInstanceInfo();
  return (
    <div className="flex h-screen bg-base text-ink-1 overflow-hidden">
      <aside className="w-52 shrink-0 flex flex-col glass-dark border-r border-overlay/6">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-overlay/6">
          {info?.avatar
            ? <img src={info.avatar} alt="" className="w-8 h-8 rounded-xl" />
            : <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center"><Server size={15} className="text-primary-light" /></div>}
          <div className="min-w-0">
            <p className="text-xs font-bold text-ink-1 leading-tight truncate" translate="no">{info?.name || 'Instance'}</p>
            <p className="text-[9px] text-primary-light font-semibold uppercase tracking-[0.15em]">Instance</p>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5" aria-label="Instance">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}>
              {({ isActive }) => (
                <span className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer
                                 ${isActive ? 'bg-primary/10 text-ink-1' : 'text-ink-3 hover:text-ink-2 hover:bg-overlay/4'}`}>
                  {isActive && <span className="absolute left-0 h-5 w-[3px] bg-primary rounded-r-full" />}
                  <Icon size={15} className={`shrink-0 ${isActive ? 'text-primary-light' : 'text-ink-4'}`} />
                  <span>{label}</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-2 pb-3 pt-2 border-t border-overlay/6 space-y-2">
          <Link to={user?.guildId ? '/' : '/select-guild'}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-ink-3 hover:text-ink-1 hover:bg-overlay/4">
            <ArrowLeft size={13} /> Retour au dashboard
          </Link>
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-overlay/3 border border-overlay/5">
            {user?.avatar
              ? <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=64`} alt="" className="w-7 h-7 rounded-full" />
              : <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-ink-1">{user?.username?.[0]?.toUpperCase()}</div>}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-ink-1 truncate leading-tight" translate="no">{user?.username}</p>
              <p className="text-[10px] text-ink-4">Propriétaire</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto min-w-0">
        <Suspense fallback={<PageLoader />}>{children}</Suspense>
      </main>
    </div>
  );
}

export default function InstanceApp() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isOwner) return <Navigate to="/" replace />;

  return (
    <InstanceLayout>
      <Routes>
        <Route path="overview" element={<Overview />} />
        <Route path="guilds"   element={<Guilds />} />
        <Route path="health"   element={<Health />} />
        <Route path="errors"   element={<Errors />} />
        <Route path="journal"  element={<Journal />} />
        <Route path="blocked"  element={<Blocked />} />
        <Route path="*" element={<Navigate to="/instance/overview" replace />} />
      </Routes>
    </InstanceLayout>
  );
}
