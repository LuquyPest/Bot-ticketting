import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Ticket, Users, ShieldBan,
  FileText, Settings, LogOut, Bot, ScrollText, Shield, ClipboardList,
  Kanban, Tag, BarChart2, Menu, X, Command, Sun, Moon,
} from 'lucide-react';
import { useAuth } from '../App';
import { useSSECtx } from '../context/SSEContext';
import { useSSE } from '../hooks/useSSE';
import { useTheme } from '../context/ThemeContext';
import NotificationBell from './NotificationBell';
import CommandPalette from './CommandPalette';
import api from '../api';
import toast from 'react-hot-toast';

const ALL_NAV = [
  { to: '/',            label: 'Dashboard',    icon: LayoutDashboard, end: true, roles: ['support','fondateur'] },
  { to: '/tickets',     label: 'Tickets',      icon: Ticket,          roles: ['support','fondateur'] },
  { to: '/kanban',      label: 'Kanban',       icon: Kanban,          roles: ['support','fondateur'] },
  { to: '/staff',       label: 'Mes stats',    icon: BarChart2,       roles: ['support'] },
  { to: '/equipe',      label: 'Équipe',       icon: Users,           roles: ['fondateur'] },
  { to: '/grades',      label: 'Grades',       icon: Shield,          roles: ['fondateur'], perm: 'manage_grades' },
  { to: '/tags',        label: 'Tags',         icon: Tag,             roles: ['fondateur'] },
  { to: '/audit',       label: 'Audit',        icon: ClipboardList,   roles: ['fondateur'], perm: 'view_audit' },
  { to: '/blacklist',   label: 'Blacklist',    icon: ShieldBan,       roles: ['fondateur'] },
  { to: '/transcripts', label: 'Transcripts',  icon: FileText,        roles: ['fondateur'] },
  { to: '/patchnotes',  label: 'Patchnotes',   icon: ScrollText,      roles: ['fondateur'] },
  { to: '/settings',    label: 'Paramètres',   icon: Settings,        roles: ['fondateur'] },
];

const ROLE_STYLES = {
  fondateur: { text: 'text-violet-300', bg: 'bg-violet-500/10 border border-violet-500/20', label: 'Fondateur' },
  support:   { text: 'text-emerald-300', bg: 'bg-emerald-500/10 border border-emerald-500/20', label: 'Support' },
  nouveau:   { text: 'text-amber-300',  bg: 'bg-amber-500/10 border border-amber-500/20',  label: 'Nouveau' },
};

const SSE_DOT = {
  connected:  { cls: 'bg-emerald-400', title: 'Connecté en temps réel' },
  connecting: { cls: 'bg-amber-400 animate-pulse', title: 'Connexion...' },
  error:      { cls: 'bg-red-400', title: 'Connexion perdue — reconnexion en cours' },
};

export default function Sidebar() {
  const { user, logout, sidebarOpen, setSidebarOpen } = useAuth();
  const { status } = useSSECtx() || { status: 'connecting' };
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [unclaimedCount, setUnclaimedCount] = useState(0);

  /* fetch unclaimed count on mount + on SSE events */
  const fetchUnclaimed = () => {
    api.get('/dashboard/stats').then(r => setUnclaimedCount(r.data.unclaimedTickets || 0)).catch(() => {});
  };
  useEffect(() => { fetchUnclaimed(); }, []);
  useSSE({ new_ticket: fetchUnclaimed, ticket: fetchUnclaimed });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
    toast.success('Déconnecté');
  };

  const avatarUrl = user?.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=64`
    : null;

  const nav = ALL_NAV.filter(item => {
    const role = user?.role;
    if (item.perm) return role === 'fondateur' || user?.permissions?.includes(item.perm);
    return item.roles.includes(role);
  });

  const roleStyle = ROLE_STYLES[user?.role] || ROLE_STYLES.nouveau;
  const dot = SSE_DOT[status] || SSE_DOT.connecting;

  /* ── keyboard shortcut ⌘K / Ctrl+K ──────────────────────────── */
  React.useEffect(() => {
    function handler(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      {/* Mobile hamburger button (outside sidebar) */}
      <button
        className="fixed top-3 left-3 z-40 p-2 rounded-xl bg-surface-card border border-white/[0.08]
                   text-ink-3 hover:text-ink-1 transition-all lg:hidden shadow-card"
        onClick={() => setSidebarOpen(o => !o)}
      >
        {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
      </button>

      <aside className={`
        w-56 flex-shrink-0 flex flex-col glass-dark border-r border-white/[0.06]
        transition-transform duration-300
        fixed inset-y-0 left-0 z-40 lg:relative lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-white/[0.06]">
          <div className="relative w-9 h-9 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-primary to-indigo-600
                            flex items-center justify-center shadow-lg shadow-primary/30">
              <Bot size={17} className="text-white" />
            </div>
            {/* SSE status dot */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2
                           border-base ${dot.cls}`}
              title={dot.title}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-ink-1 leading-tight tracking-tight">Ticket Bot</p>
            <p className="text-[9px] text-primary-light/60 font-semibold uppercase tracking-[0.15em]">
              Dashboard
            </p>
          </div>
          {/* ⌘K button */}
          <button
            onClick={() => setCmdOpen(true)}
            title="Recherche (⌘K)"
            className="p-1.5 rounded-lg text-ink-4 hover:text-ink-1 hover:bg-white/[0.06]
                       transition-all flex-shrink-0"
          >
            <Command size={13} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={`${to}-${label}`}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
            >
              {({ isActive }) => (
                <span className={`
                  relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium
                  transition-all duration-150 cursor-pointer group
                  ${isActive
                    ? 'bg-primary/10 text-ink-1'
                    : 'text-ink-3 hover:text-ink-2 hover:bg-white/[0.04]'}
                `}>
                  {isActive && (
                    <span className="absolute left-0 h-5 w-[3px] bg-gradient-to-b from-primary-light to-primary
                                     rounded-r-full shadow-[0_0_10px_rgba(124,110,243,0.7)]" />
                  )}
                  <Icon
                    size={15}
                    className={`flex-shrink-0 transition-colors ${
                      isActive ? 'text-primary-light' : 'text-ink-4 group-hover:text-ink-3'
                    }`}
                  />
                  <span className="truncate flex-1">{label}</span>
                  {/* Unclaimed badge on Tickets */}
                  {to === '/tickets' && unclaimedCount > 0 && (
                    <span className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] px-1
                                     rounded-full bg-amber-500/20 border border-amber-500/30
                                     text-amber-300 text-[10px] font-bold
                                     flex items-center justify-center tabular-nums
                                     shadow-[0_0_8px_rgba(245,158,11,0.25)]">
                      {unclaimedCount > 99 ? '99+' : unclaimedCount}
                    </span>
                  )}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-2 pb-3 pt-2 border-t border-white/[0.06]">
          <div className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl
                          bg-white/[0.03] border border-white/[0.05]">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full ring-1 ring-white/10" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600
                                flex items-center justify-center text-xs font-bold text-white">
                  {user?.username?.[0]?.toUpperCase()}
                </div>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full
                               bg-emerald-400 border-2 border-base" />
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-1 truncate font-semibold leading-tight">{user?.username}</p>
              {user?.role && (
                <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wide
                                 px-1.5 py-0.5 rounded-md mt-0.5 ${roleStyle.bg} ${roleStyle.text}`}>
                  {roleStyle.label}
                </span>
              )}
            </div>

            {/* Notification bell */}
            <NotificationBell />

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
              className="text-ink-4 hover:text-primary-light hover:bg-primary/10 p-1.5 rounded-lg
                         transition-all duration-150 flex-shrink-0"
            >
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            </button>

            {/* Logout */}
            <button
              onClick={handleLogout}
              title="Déconnexion"
              className="text-ink-4 hover:text-red-400 hover:bg-red-400/10 p-1.5 rounded-lg
                         transition-all duration-150 flex-shrink-0"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </>
  );
}
