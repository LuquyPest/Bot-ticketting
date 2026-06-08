import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Lightbulb, Plus, X, Shield, PlaneTakeoff } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { fmtDate } from '../utils/format';

const ROLE_STYLES = {
  fondateur: 'bg-indigo-600/20 text-primary-light border-indigo-600/30',
  support:   'bg-emerald-600/20 text-emerald-400 border-emerald-600/30',
  nouveau:   'bg-amber-600/20 text-amber-400 border-amber-600/30'
};
const ROLE_LABELS = { fondateur: 'Fondateur', support: 'Support', nouveau: 'Nouveau' };

function GradeTag({ grade, onRemove, canManage }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border"
      style={{ backgroundColor: `${grade.color}20`, color: grade.color, borderColor: `${grade.color}40` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: grade.color }} />
      {grade.name}
      {canManage && onRemove && (
        <button onClick={() => onRemove(grade)} className="ml-0.5 hover:opacity-70 transition-opacity">
          <X size={9} />
        </button>
      )}
    </span>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);
  const [assigningTo, setAssigningTo] = useState(null);
  const [selectedGrade, setSelectedGrade] = useState('');

  const canManage = me?.role === 'fondateur' || me?.permissions?.includes('manage_users');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/users'),
      api.get('/grades')
    ]).then(([ur, gr]) => {
      setUsers(ur.data);
      setGrades(gr.data);
    }).catch(() => toast.error('Erreur chargement')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeRole = async (userId, role) => {
    if (!me?.role === 'fondateur') return;
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

  const assignGrade = async (userId) => {
    if (!selectedGrade) return;
    setUpdating(userId);
    try {
      const r = await api.post(`/users/${userId}/grades`, { grade_id: parseInt(selectedGrade) });
      setUsers(u => u.map(x => {
        if (x.user_id !== userId) return x;
        const already = x.grades?.find(g => g.id === r.data.grade.id);
        if (already) return x;
        const newRole = x.role === 'nouveau' ? 'support' : x.role;
        return { ...x, role: newRole, grades: [...(x.grades || []), r.data.grade] };
      }));
      setAssigningTo(null);
      setSelectedGrade('');
      toast.success('Grade attribué');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setUpdating(null);
    }
  };

  const removeGrade = async (userId, grade) => {
    setUpdating(userId);
    try {
      await api.delete(`/users/${userId}/grades/${grade.id}`);
      setUsers(u => u.map(x => x.user_id === userId
        ? { ...x, grades: x.grades.filter(g => g.id !== grade.id) }
        : x
      ));
      toast.success('Grade retiré');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setUpdating(null);
    }
  };

  const toggleVacation = async (userId, current) => {
    setUpdating(userId);
    try {
      await api.patch(`/users/${userId}/vacation`, { vacation_mode: !current });
      setUsers(u => u.map(x => x.user_id === userId ? { ...x, vacation_mode: !current ? 1 : 0 } : x));
      toast.success(!current ? 'Mode vacances activé' : 'Mode vacances désactivé');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setUpdating(null);
    }
  };

  const pendingCount = users.filter(u => u.role === 'nouveau').length;
  const suggestedCount = users.filter(u => u.role === 'nouveau' && u.discord_has_support).length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Gestion des utilisateurs</h1>
          <p className="text-sm text-ink-3 mt-0.5">
            {users.length} utilisateur(s)
            {pendingCount > 0 && <span className="ml-2 text-amber-400">· {pendingCount} en attente</span>}
            {suggestedCount > 0 && <span className="ml-2 text-primary-light">· {suggestedCount} suggestion(s)</span>}
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface transition-colors" title="Rafraîchir">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-surface-card border border-white/[0.06] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-xs text-ink-3 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Utilisateur</th>
              <th className="text-left px-4 py-3 font-medium">Statut</th>
              <th className="text-left px-4 py-3 font-medium">Grades</th>
              <th className="text-left px-4 py-3 font-medium">Vacances</th>
              <th className="text-left px-4 py-3 font-medium">Dernière connexion</th>
              {me?.role === 'fondateur' && <th className="text-left px-4 py-3 font-medium">Rôle</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-10 text-ink-4">Chargement...</td></tr>
            ) : !users.length ? (
              <tr><td colSpan={6} className="text-center py-10 text-ink-4">Aucun utilisateur</td></tr>
            ) : users.map(u => {
              const isMe = u.user_id === me?.id;
              const isSuggested = u.role === 'nouveau' && u.discord_has_support;
              const avatarUrl = u.avatar
                ? `https://cdn.discordapp.com/avatars/${u.user_id}/${u.avatar}.webp?size=32`
                : null;
              const isAssigning = assigningTo === u.user_id;
              const userGrades = u.grades || [];
              const availableGrades = grades.filter(g => !userGrades.find(ug => ug.id === g.id));

              return (
                <tr
                  key={u.user_id}
                  className={`border-b border-white/[0.06]/50 last:border-0 transition-colors ${isSuggested ? 'bg-indigo-600/5 hover:bg-indigo-600/10' : 'hover:bg-surface/20'} ${updating === u.user_id ? 'opacity-60' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {avatarUrl
                        ? <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                        : <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0">{u.username?.[0]?.toUpperCase()}</div>
                      }
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-ink-1 font-medium">{u.username}</p>
                          {isMe && <span className="text-xs text-ink-3">(moi)</span>}
                          {isSuggested && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-600/20 border border-indigo-600/30 text-primary-light text-xs">
                              <Lightbulb size={10} /> Suggéré
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-ink-4 font-mono">{u.user_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${ROLE_STYLES[u.role]}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.role === 'fondateur' ? (
                      <span className="text-xs text-primary-light italic">Accès total</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {userGrades.map(g => (
                          <GradeTag
                            key={g.id}
                            grade={g}
                            canManage={canManage && !isMe}
                            onRemove={canManage && !isMe ? (grade) => removeGrade(u.user_id, grade) : null}
                          />
                        ))}
                        {canManage && !isMe && !isAssigning && (
                          <button
                            onClick={() => { setAssigningTo(u.user_id); setSelectedGrade(''); }}
                            disabled={availableGrades.length === 0}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border border-dashed border-white/[0.1] text-ink-3 hover:border-indigo-500 hover:text-primary-light transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Plus size={9} /> Attribuer
                          </button>
                        )}
                        {canManage && isAssigning && (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={selectedGrade}
                              onChange={e => setSelectedGrade(e.target.value)}
                              className="bg-surface border border-white/[0.08] text-ink-2 rounded-md px-2 py-0.5 text-xs focus:outline-none focus:border-primary"
                              autoFocus
                            >
                              <option value="">— Choisir...</option>
                              {availableGrades.map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => assignGrade(u.user_id)}
                              disabled={!selectedGrade}
                              className="p-1 rounded text-emerald-400 hover:bg-emerald-400/10 disabled:opacity-30 transition-colors"
                            >
                              <Shield size={12} />
                            </button>
                            <button
                              onClick={() => { setAssigningTo(null); setSelectedGrade(''); }}
                              className="p-1 rounded text-ink-3 hover:text-ink-2 hover:bg-surface-hover transition-colors"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.role !== 'fondateur' && canManage && !isMe ? (
                      <button
                        onClick={() => toggleVacation(u.user_id, u.vacation_mode)}
                        disabled={updating === u.user_id}
                        title={u.vacation_mode ? 'Désactiver les vacances' : 'Activer les vacances'}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                          u.vacation_mode
                            ? 'bg-sky-500/20 border-sky-500/40 text-sky-400 hover:bg-sky-500/30'
                            : 'bg-surface border-white/[0.08] text-ink-3 hover:border-white/[0.12]'
                        }`}
                      >
                        <PlaneTakeoff size={11} />
                        {u.vacation_mode ? 'Actif' : 'Non'}
                      </button>
                    ) : (
                      <span className="text-ink-4 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-3 text-xs">{fmtDate(u.last_login)}</td>
                  {me?.role === 'fondateur' && (
                    <td className="px-4 py-3">
                      {isMe ? (
                        <span className="text-xs text-ink-4 italic">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <select
                            value={u.role}
                            disabled={updating === u.user_id}
                            onChange={e => changeRole(u.user_id, e.target.value)}
                            className="bg-surface border border-white/[0.08] text-ink-2 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-primary disabled:opacity-50"
                          >
                            <option value="nouveau">Nouveau</option>
                            <option value="support">Support</option>
                            <option value="fondateur">Fondateur</option>
                          </select>
                          {isSuggested && (
                            <button
                              onClick={() => changeRole(u.user_id, 'support')}
                              disabled={updating === u.user_id}
                              className="px-2 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-600/30 text-primary-light text-xs hover:bg-indigo-600/30 transition-colors disabled:opacity-50 whitespace-nowrap"
                            >
                              → Support
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-surface-card/50 border border-white/[0.06] rounded-xl p-4 space-y-1.5">
        <p className="text-xs text-ink-3 leading-relaxed">
          <span className="text-amber-400 font-medium">Nouveau</span> — Accès refusé. Attribuez un grade pour donner l'accès. ·{' '}
          <span className="text-emerald-400 font-medium">Support</span> — Accès selon les permissions de ses grades. ·{' '}
          <span className="text-primary-light font-medium">Fondateur</span> — Accès complet sans restriction.
        </p>
        <p className="text-xs text-ink-4">
          Attribuer un grade à un utilisateur "Nouveau" le fait automatiquement passer en "Support".
        </p>
      </div>
    </div>
  );
}
