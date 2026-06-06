import React, { useEffect, useState } from 'react';
import { Users as UsersIcon, RefreshCw } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

const ROLE_STYLES = {
  fondateur: 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30',
  support:   'bg-emerald-600/20 text-emerald-400 border-emerald-600/30',
  nouveau:   'bg-amber-600/20 text-amber-400 border-amber-600/30'
};

const ROLE_LABELS = { fondateur: 'Fondateur', support: 'Support', nouveau: 'Nouveau' };

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/users').then(r => setUsers(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const changeRole = async (userId, role) => {
    setUpdating(userId);
    try {
      await api.patch(`/users/${userId}/role`, { role });
      setUsers(u => u.map(x => x.user_id === userId ? { ...x, role } : x));
      toast.success('Rôle mis à jour');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setUpdating(null);
    }
  };

  const config = require('../../config.json');

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Gestion des utilisateurs</h1>
          <p className="text-sm text-slate-500 mt-0.5">{users.length} utilisateur(s) connecté(s) au dashboard</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:text-slate-100 hover:bg-slate-800 transition-colors" title="Rafraîchir">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Utilisateur</th>
              <th className="text-left px-4 py-3 font-medium">Rôle actuel</th>
              <th className="text-left px-4 py-3 font-medium">Première connexion</th>
              <th className="text-left px-4 py-3 font-medium">Dernière connexion</th>
              <th className="text-left px-4 py-3 font-medium">Changer le rôle</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-10 text-slate-600">Chargement...</td></tr>
            ) : !users.length ? (
              <tr><td colSpan={5} className="text-center py-10 text-slate-600">Aucun utilisateur</td></tr>
            ) : users.map(u => {
              const isMe = u.user_id === me?.id;
              const avatarUrl = u.avatar
                ? `https://cdn.discordapp.com/avatars/${u.user_id}/${u.avatar}.webp?size=32`
                : null;

              return (
                <tr key={u.user_id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {avatarUrl
                        ? <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                        : <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0">{u.username?.[0]?.toUpperCase()}</div>
                      }
                      <div>
                        <p className="text-slate-200 font-medium">{u.username}{isMe && <span className="ml-1.5 text-xs text-slate-500">(moi)</span>}</p>
                        <p className="text-xs text-slate-600 font-mono">{u.user_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${ROLE_STYLES[u.role]}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(u.first_login)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(u.last_login)}</td>
                  <td className="px-4 py-3">
                    {isMe ? (
                      <span className="text-xs text-slate-600 italic">—</span>
                    ) : (
                      <select
                        value={u.role}
                        disabled={updating === u.user_id}
                        onChange={e => changeRole(u.user_id, e.target.value)}
                        className="bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                      >
                        <option value="nouveau">Nouveau</option>
                        <option value="support">Support</option>
                        <option value="fondateur">Fondateur</option>
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <p className="text-xs text-slate-500 leading-relaxed">
          <span className="text-amber-400 font-medium">Nouveau</span> — Accès refusé, en attente de validation. ·{' '}
          <span className="text-emerald-400 font-medium">Support</span> — Peut voir les stats générales et ses propres statistiques. ·{' '}
          <span className="text-indigo-400 font-medium">Fondateur</span> — Accès complet : paramètres, blacklist, transcripts, gestion des utilisateurs.
        </p>
      </div>
    </div>
  );
}
