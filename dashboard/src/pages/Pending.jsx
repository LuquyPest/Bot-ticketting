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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <div className="w-14 h-14 rounded-full bg-amber-600/15 flex items-center justify-center mx-auto mb-5">
            <Clock size={28} className="text-amber-400" />
          </div>

          <h1 className="text-xl font-bold text-slate-100 mb-2">Compte en attente</h1>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            Ton compte a bien été créé. Un fondateur doit te donner accès au dashboard.
            Reviens ici une fois que tu auras été promu.
          </p>

          {user && (
            <div className="flex items-center gap-3 bg-slate-800 rounded-xl p-3 mb-6 text-left">
              {avatarUrl
                ? <img src={avatarUrl} alt="" className="w-10 h-10 rounded-full flex-shrink-0" />
                : <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold flex-shrink-0">{user.username?.[0]?.toUpperCase()}</div>
              }
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">{user.username}</p>
                <p className="text-xs text-slate-500">ID : {user.id}</p>
              </div>
              <span className="ml-auto px-2 py-1 rounded-md bg-amber-600/20 text-amber-400 border border-amber-600/30 text-xs font-medium flex-shrink-0">
                nouveau
              </span>
            </div>
          )}

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 mx-auto px-4 py-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-600/10 text-sm transition-colors"
          >
            <LogOut size={15} /> Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
