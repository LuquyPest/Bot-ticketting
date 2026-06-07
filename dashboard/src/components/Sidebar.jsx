import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Ticket, Users, ShieldBan,
  FileText, Settings, LogOut, Bot, UserCog, ScrollText
} from 'lucide-react';
import { useAuth } from '../App';
import toast from 'react-hot-toast';

const ALL_NAV = [
  { to: '/',            label: 'Dashboard',    icon: LayoutDashboard, end: true, roles: ['support', 'fondateur'] },
  { to: '/tickets',     label: 'Tickets',      icon: Ticket,          roles: ['support', 'fondateur'] },
  { to: '/staff',       label: 'Mes stats',    icon: Users,           roles: ['support'] },
  { to: '/staff',       label: 'Staff',        icon: Users,           roles: ['fondateur'] },
  { to: '/blacklist',   label: 'Blacklist',    icon: ShieldBan,       roles: ['fondateur'] },
  { to: '/transcripts', label: 'Transcripts',  icon: FileText,        roles: ['fondateur'] },
  { to: '/users',       label: 'Utilisateurs', icon: UserCog,         roles: ['fondateur'] },
  { to: '/patchnotes',  label: 'Patchnotes',   icon: ScrollText,      roles: ['fondateur'] },
  { to: '/settings',    label: 'Paramètres',   icon: Settings,        roles: ['fondateur'] }
];

const ROLE_COLORS = {
  fondateur: 'text-indigo-400',
  support:   'text-emerald-400',
  nouveau:   'text-amber-400'
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

  const nav = ALL_NAV.filter(item => item.roles.includes(user?.role));

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-slate-900 border-r border-slate-800/60">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-slate-800/60">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
          <Bot size={17} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-100 leading-tight">Ticket Bot</p>
          <p className="text-[10px] text-slate-600 font-medium uppercase tracking-wider">Dashboard</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={`${to}-${label}`}
            to={to}
            end={end}
          >
            {({ isActive }) => (
              <span className={`relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
              }`}>
                {isActive && (
                  <span className="absolute left-0 h-4 w-0.5 bg-indigo-400 rounded-r-full" />
                )}
                <Icon size={16} className={isActive ? 'text-indigo-400' : ''} />
                {label}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-2 pb-3 pt-2 border-t border-slate-800/60">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-slate-800/40">
          {avatarUrl
            ? <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full flex-shrink-0 ring-1 ring-slate-700" />
            : <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0">{user?.username?.[0]?.toUpperCase()}</div>
          }
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-300 truncate font-medium leading-tight">{user?.username}</p>
            {user?.role && (
              <p className={`text-[10px] font-semibold leading-tight ${ROLE_COLORS[user.role]}`}>
                {ROLE_LABELS[user.role]}
              </p>
            )}
          </div>
          <button onClick={handleLogout} title="Déconnexion" className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
