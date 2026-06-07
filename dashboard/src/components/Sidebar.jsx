import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Ticket, Users, ShieldBan,
  FileText, Settings, LogOut, Bot, ScrollText, Shield, ClipboardList,
  Kanban, Tag, BarChart2
} from 'lucide-react';
import { useAuth } from '../App';
import toast from 'react-hot-toast';

// nav items: roles = required role OR perm = required permission (fondateur bypasses all)
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
  { to: '/settings',    label: 'Paramètres',   icon: Settings,        roles: ['fondateur'] }
];

const ROLE_COLORS = {
  fondateur: 'text-indigo-400',
  support:   'text-emerald-400',
  nouveau:   'text-amber-400'
};

const ROLE_BG = {
  fondateur: 'bg-indigo-600/15',
  support:   'bg-emerald-600/15',
  nouveau:   'bg-amber-600/15'
};

const ROLE_LABELS = { fondateur: 'Fondateur', support: 'Support', nouveau: 'Nouveau' };

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
    // Items with a `perm`: visible to fondateur OR to users with that specific permission
    if (item.perm) return role === 'fondateur' || user?.permissions?.includes(item.perm);
    // Role-based items: strict match (fondateur sees fondateur items, support sees support items)
    return item.roles.includes(role);
  });

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-slate-900/80 border-r border-slate-800/60 backdrop-blur-sm">

      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-800/60">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-900/40">
          <Bot size={18} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-100 leading-tight">Ticket Bot</p>
          <p className="text-[10px] text-indigo-400/70 font-semibold uppercase tracking-widest">Dashboard</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={`${to}-${label}`} to={to} end={end}>
            {({ isActive }) => (
              <span className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                isActive
                  ? 'bg-indigo-600/10 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'
              }`}>
                {isActive && (
                  <span className="absolute left-0 h-5 w-0.5 bg-indigo-400 rounded-r-full shadow-[0_0_8px_rgba(99,102,241,0.7)]" />
                )}
                <Icon size={16} className={isActive ? 'text-indigo-400' : 'text-slate-600'} />
                {label}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-2 pb-3 pt-2 border-t border-slate-800/60">
        <div className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/30">
          <div className="relative flex-shrink-0">
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full ring-1 ring-slate-700" />
              : <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-xs font-bold text-white">
                  {user?.username?.[0]?.toUpperCase()}
                </div>
            }
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-900" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-200 truncate font-semibold leading-tight">{user?.username}</p>
            {user?.role && (
              <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md mt-0.5 ${ROLE_BG[user.role]} ${ROLE_COLORS[user.role]}`}>
                {ROLE_LABELS[user.role]}
              </span>
            )}
          </div>
          <button
            onClick={handleLogout}
            title="Déconnexion"
            className="text-slate-600 hover:text-red-400 hover:bg-red-400/10 p-1.5 rounded-lg transition-colors flex-shrink-0"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
