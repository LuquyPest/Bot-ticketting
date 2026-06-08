import React from 'react';
import { Clock, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import api from '../api';
import toast from 'react-hot-toast';

export default function Pending() {
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

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center animate-slide-up">
        <div className="bg-surface-card border border-white/[0.07] rounded-2xl p-8
                        shadow-[0_8px_48px_rgba(0,0,0,0.5)]">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20
                          flex items-center justify-center mx-auto mb-5">
            <Clock size={26} className="text-amber-400" />
          </div>

          <h1 className="text-xl font-bold text-ink-1 mb-2">Compte en attente</h1>
          <p className="text-sm text-ink-2 mb-6 leading-relaxed">
            Ton compte a bien été créé. Un fondateur doit te donner accès au dashboard.
            Reviens ici une fois que tu auras été promu.
          </p>

          {user && (
            <div className="flex items-center gap-3 bg-surface border border-white/[0.06] rounded-xl p-3 mb-6 text-left">
              {avatarUrl
                ? <img src={avatarUrl} alt="" className="w-10 h-10 rounded-full flex-shrink-0 ring-1 ring-white/10" />
                : <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-indigo-600 flex items-center justify-center text-sm font-bold flex-shrink-0 text-white">{user.username?.[0]?.toUpperCase()}</div>
              }
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-1 truncate">{user.username}</p>
                <p className="text-xs text-ink-4 font-mono">ID : {user.id}</p>
              </div>
              <span className="ml-auto px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-semibold flex-shrink-0">
                nouveau
              </span>
            </div>
          )}

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl text-ink-3
                       hover:text-red-400 hover:bg-red-500/10 text-sm transition-all"
          >
            <LogOut size={15} /> Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
