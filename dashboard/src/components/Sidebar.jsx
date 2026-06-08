import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Ticket, Users, ShieldBan,
  FileText, Settings, LogOut, Bot, ScrollText, Shield, ClipboardList,
  Kanban, Tag, BarChart2
} from 'lucide-react';
import { useAuth } from '../App';
import toast from 'react-hot-toast';

const ALL_NAV = [
  { to: '/',            label: 'Dashboard',    icon: LayoutDashboard, end: true, roles: ['support', 'fondateur'] },
  { to: '/tickets',     label: 'Tickets',      icon: Ticket,          roles: ['support', 'fondateur'] },
  { to: '/kanban',      label: 'Kanban',       icon: Kanban,          roles: ['support', 'fondateur'] },
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

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col glass-dark border-r border-white/[0.06]">

      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-white/[0.06]">
        <div className="relative w-9 h-9 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-primary to-indigo-600
                          flex items-center justify-center shadow-lg shadow-primary/30">
            <Bot size={17} className="text-white" />
          </div>
          <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600
                          opacity-0 blur-md -z-10 animate-glow-pulse" />
        </div>
        <div>
          <p className="text-sm font-bold text-ink-1 leading-tight tracking-tight">Ticket Bot</p>
          <p className="text-[9px] text-primary-light/60 font-semibold uppercase tracking-[0.15em]">Dashboard</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={`${to}-${label}`} to={to} end={end}>
            {({ isActive }) => (
              <span className={`
                relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium
                transition-all duration-150 cursor-pointer group
                ${isActive
                  ? 'bg-primary/10 text-ink-1'
                  : 'text-ink-3 hover:text-ink-2 hover:bg-white/[0.04]'}
              `}>
                {/* Active indicator */}
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
                <span className="truncate">{label}</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-2 pb-3 pt-2 border-t border-white/[0.06]">
        <div className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="w-8 h-8 rounded-full ring-1 ring-white/10"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600
                              flex items-center justify-center text-xs font-bold text-white">
                {user?.username?.[0]?.toUpperCase()}
              </div>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full
                             bg-emerald-400 border-2 border-[#09090f]" />
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
  );
}
