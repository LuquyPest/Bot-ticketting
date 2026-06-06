import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Ticket, Users, ShieldBan,
  FileText, Settings, LogOut, Bot, UserCog
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
  { to: '/settings',    label: 'Paramètres',   icon: Settings,        roles: ['fondateur'] }
];

const ROLE_STYLES = {
  fondateur: 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30',
  support:   'bg-emerald-600/20 text-emerald-400 border-emerald-600/30',
  nouveau:   'bg-amber-600/20 text-amber-400 border-amber-600/30'
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
    <aside className="w-60 flex-shrink-0 flex flex-col bg-slate-900 border-r border-slate-800">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
        <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
          <Bot size={20} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-100 leading-tight">Ticket Bot</p>
          <p className="text-xs text-slate-500">Dashboard</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={`${to}-${label}`}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800 border border-transparent'
              }`
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 pb-4 border-t border-slate-800 pt-3 space-y-2">
        {user?.role && (
          <div className="px-3">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${ROLE_STYLES[user.role]}`}>
              {ROLE_LABELS[user.role]}
            </span>
          </div>
        )}
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800/50">
          {avatarUrl
            ? <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
            : <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0">{user?.username?.[0]?.toUpperCase()}</div>
          }
          <span className="text-sm text-slate-300 truncate flex-1">{user?.username}</span>
          <button onClick={handleLogout} title="Déconnexion" className="text-slate-500 hover:text-red-400 transition-colors">
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
