import React, { useEffect, useState, useCallback } from 'react';
import { Users, BarChart2, RefreshCw, Lightbulb, Plus, X, Shield, PlaneTakeoff, Star, Clock, Ticket, AlertCircle } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { fmtDate, fmtDuration } from '../utils/format';

// ─── Grade tag component ───────────────────────────────────────────
function GradeTag({ grade, onRemove, canManage }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border"
      style={{ backgroundColor: `${grade.color}20`, color: grade.color, borderColor: `${grade.color}40` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: grade.color }} />
      {grade.name}
      {canManage && onRemove && (
        <button onClick={() => onRemove(grade)} className="ml-0.5 hover:opacity-70 transition-opacity"><X size={9} /></button>
      )}
    </span>
  );
}

const ROLE_STYLES = {
  fondateur: 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30',
  support:   'bg-emerald-600/20 text-emerald-400 border-emerald-600/30',
  nouveau:   'bg-amber-600/20 text-amber-400 border-amber-600/30'
};
const ROLE_LABELS = { fondateur: 'Fondateur', support: 'Support', nouveau: 'Nouveau' };

// ─── Gestion tab ───────────────────────────────────────────────────
function GestionTab({ me }) {
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
      api.get('/grades').catch(() => ({ data: [] }))
    ]).then(([ur, gr]) => {
      setUsers(ur.data);
      setGrades(gr.data);
    }).catch(() => toast.error('Erreur chargement utilisateurs')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeRole = async (userId, role) => {
    setUpdating(userId);
    try {
      await api.patch(`/users/${userId}/role`, { role });
      setUsers(u => u.map(x => x.user_id === userId ? { ...x, role } : x));
      toast.success('Rôle mis à jour');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally { setUpdating(null); }
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
        return { ...x, role: x.role === 'nouveau' ? 'support' : x.role, grades: [...(x.grades || []), r.data.grade] };
      }));
      setAssigningTo(null);
      setSelectedGrade('');
      toast.success('Grade attribué');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally { setUpdating(null); }
  };

  const removeGrade = async (userId, grade) => {
    setUpdating(userId);
    try {
      await api.delete(`/users/${userId}/grades/${grade.id}`);
      setUsers(u => u.map(x => x.user_id === userId ? { ...x, grades: x.grades.filter(g => g.id !== grade.id) } : x));
      toast.success('Grade retiré');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally { setUpdating(null); }
  };

  const toggleVacation = async (userId, current) => {
    setUpdating(userId);
    try {
      await api.patch(`/users/${userId}/vacation`, { vacation_mode: !current });
      setUsers(u => u.map(x => x.user_id === userId ? { ...x, vacation_mode: !current ? 1 : 0 } : x));
      toast.success(!current ? 'Mode vacances activé' : 'Mode vacances désactivé');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally { setUpdating(null); }
  };

  const pendingCount = users.filter(u => u.role === 'nouveau').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {users.length} utilisateur(s)
          {pendingCount > 0 && <span className="ml-2 text-amber-400">· {pendingCount} en attente</span>}
        </p>
        <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:text-slate-100 hover:bg-slate-800 transition-colors">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Utilisateur</th>
              <th className="text-left px-4 py-3 font-medium">Statut</th>
              <th className="text-left px-4 py-3 font-medium">Grades</th>
              <th className="text-left px-4 py-3 font-medium">Vacances</th>
              <th className="text-left px-4 py-3 font-medium">Connexion</th>
              <th className="text-left px-4 py-3 font-medium">Rôle</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-10 text-slate-600">Chargement...</td></tr>
            ) : !users.length ? (
              <tr><td colSpan={6} className="text-center py-10 text-slate-600">Aucun utilisateur</td></tr>
            ) : users.map(u => {
              const isMe = u.user_id === me?.id;
              const isSuggested = u.role === 'nouveau' && u.discord_has_support;
              const avatarUrl = u.avatar ? `https://cdn.discordapp.com/avatars/${u.user_id}/${u.avatar}.webp?size=32` : null;
              const isAssigning = assigningTo === u.user_id;
              const userGrades = u.grades || [];
              const availableGrades = grades.filter(g => !userGrades.find(ug => ug.id === g.id));
              return (
                <tr key={u.user_id}
                  className={`border-b border-slate-800/50 last:border-0 transition-colors ${isSuggested ? 'bg-indigo-600/5 hover:bg-indigo-600/10' : 'hover:bg-slate-800/20'} ${updating === u.user_id ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {avatarUrl
                        ? <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                        : <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0">{u.username?.[0]?.toUpperCase()}</div>
                      }
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-slate-200 font-medium">{u.username}</p>
                          {isMe && <span className="text-xs text-slate-500">(moi)</span>}
                          {isSuggested && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-600/20 border border-indigo-600/30 text-indigo-400 text-xs">
                              <Lightbulb size={10} /> Suggéré
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 font-mono">{u.user_id}</p>
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
                      <span className="text-xs text-indigo-400 italic">Accès total</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {userGrades.map(g => (
                          <GradeTag key={g.id} grade={g} canManage={canManage && !isMe} onRemove={canManage && !isMe ? (grade) => removeGrade(u.user_id, grade) : null} />
                        ))}
                        {canManage && !isMe && !isAssigning && (
                          <button onClick={() => { setAssigningTo(u.user_id); setSelectedGrade(''); }}
                            disabled={availableGrades.length === 0}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border border-dashed border-slate-600 text-slate-500 hover:border-indigo-500 hover:text-indigo-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                            <Plus size={9} /> Attribuer
                          </button>
                        )}
                        {canManage && isAssigning && (
                          <div className="flex items-center gap-1.5">
                            <select value={selectedGrade} onChange={e => setSelectedGrade(e.target.value)}
                              className="bg-slate-800 border border-slate-700 text-slate-300 rounded-md px-2 py-0.5 text-xs focus:outline-none focus:border-indigo-500" autoFocus>
                              <option value="">— Choisir...</option>
                              {availableGrades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                            <button onClick={() => assignGrade(u.user_id)} disabled={!selectedGrade}
                              className="p-1 rounded text-emerald-400 hover:bg-emerald-400/10 disabled:opacity-30 transition-colors">
                              <Shield size={12} />
                            </button>
                            <button onClick={() => { setAssigningTo(null); setSelectedGrade(''); }}
                              className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors">
                              <X size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.role !== 'fondateur' && canManage && !isMe ? (
                      <button onClick={() => toggleVacation(u.user_id, u.vacation_mode)} disabled={updating === u.user_id}
                        title={u.vacation_mode ? 'Désactiver les vacances' : 'Activer les vacances'}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${u.vacation_mode ? 'bg-sky-500/20 border-sky-500/40 text-sky-400 hover:bg-sky-500/30' : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-500'}`}>
                        <PlaneTakeoff size={11} />
                        {u.vacation_mode ? 'Actif' : 'Non'}
                      </button>
                    ) : <span className="text-slate-700 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(u.last_login)}</td>
                  <td className="px-4 py-3">
                    {isMe ? <span className="text-xs text-slate-600 italic">—</span> : (
                      <div className="flex items-center gap-2">
                        <select value={u.role} disabled={updating === u.user_id} onChange={e => changeRole(u.user_id, e.target.value)}
                          className="bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 disabled:opacity-50">
                          <option value="nouveau">Nouveau</option>
                          <option value="support">Support</option>
                          <option value="fondateur">Fondateur</option>
                        </select>
                        {isSuggested && (
                          <button onClick={() => changeRole(u.user_id, 'support')} disabled={updating === u.user_id}
                            className="px-2 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-600/30 text-indigo-400 text-xs hover:bg-indigo-600/30 transition-colors disabled:opacity-50 whitespace-nowrap">
                            → Support
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-1.5">
        <p className="text-xs text-slate-500 leading-relaxed">
          <span className="text-amber-400 font-medium">Nouveau</span> — Accès refusé. Attribuez un grade pour donner l'accès. ·{' '}
          <span className="text-emerald-400 font-medium">Support</span> — Accès selon les permissions de ses grades. ·{' '}
          <span className="text-indigo-400 font-medium">Fondateur</span> — Accès complet sans restriction.
        </p>
        <p className="text-xs text-slate-600">Attribuer un grade à un utilisateur "Nouveau" le fait automatiquement passer en "Support".</p>
      </div>
    </div>
  );
}

// ─── Stats tab ─────────────────────────────────────────────────────
function StarRating({ value }) {
  if (!value) return <span className="text-slate-700">—</span>;
  const num = parseFloat(value);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {[1,2,3,4,5].map(i => (
          <Star key={i} size={11} fill={i <= Math.round(num) ? '#f59e0b' : 'none'} className={i <= Math.round(num) ? 'text-amber-400' : 'text-slate-700'} />
        ))}
      </div>
      <span className="text-xs text-slate-400 font-medium">{num.toFixed(1)}</span>
    </div>
  );
}

function StatsTab() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('tickets_closed');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/staff')
      .then(r => setStaff(r.data))
      .catch(err => {
        const msg = err.response?.data?.error || 'Erreur de chargement';
        setError(msg);
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const sorted = [...staff].sort((a, b) => {
    if (sort === 'avgResponseSeconds') {
      return (a.avgResponseSeconds ?? Infinity) - (b.avgResponseSeconds ?? Infinity);
    }
    return (b[sort] ?? 0) - (a[sort] ?? 0);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{staff.length} membre(s) actif(s)</p>
        <div className="flex items-center gap-2">
          <select value={sort} onChange={e => setSort(e.target.value)}
            className="bg-slate-800/50 border border-slate-700/60 text-slate-400 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500/60">
            <option value="tickets_closed">Trier par fermetures</option>
            <option value="tickets_claimed">Trier par claims</option>
            <option value="avgRating">Trier par note</option>
            <option value="avgResponseSeconds">Trier par temps de réponse</option>
          </select>
          <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:text-slate-100 hover:bg-slate-800 transition-colors">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800/60 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800/60">
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">#</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Membre</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Fermetures</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Claims</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Tps réponse moy.</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Note moy.</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Dernière activité</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-600 text-sm">Chargement...</td></tr>
            ) : error ? (
              <tr><td colSpan={7}>
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-12 h-12 rounded-full bg-red-600/10 flex items-center justify-center">
                    <AlertCircle size={22} className="text-red-400" />
                  </div>
                  <p className="text-sm text-red-400 font-medium">{error}</p>
                </div>
              </td></tr>
            ) : !sorted.length ? (
              <tr><td colSpan={7}>
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
                    <Users size={22} className="text-slate-600" />
                  </div>
                  <p className="text-sm text-slate-600 font-medium">Aucune statistique disponible</p>
                </div>
              </td></tr>
            ) : sorted.map((s, i) => (
              <tr key={s.admin_id} className="border-b border-slate-800/40 last:border-0 hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-3 text-slate-700 font-mono text-xs">{i + 1}</td>
                <td className="px-4 py-3">
                  <div>
                    <p className="text-slate-200 font-medium text-sm">{s.admin_tag}</p>
                    <p className="text-[10px] text-slate-600 font-mono mt-0.5">{s.admin_id}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <Ticket size={12} className="text-emerald-500" />
                    <span className="text-slate-200 font-semibold text-sm">{s.tickets_closed}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400 text-sm">{s.tickets_claimed}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <Clock size={12} className="text-amber-500" />
                    <span className="text-slate-400 text-sm">{fmtDuration(s.avgResponseSeconds)}</span>
                  </div>
                </td>
                <td className="px-4 py-3"><StarRating value={s.avgRating} /></td>
                <td className="px-4 py-3 text-slate-600 text-xs">
                  {fmtDate(s.updated_at, { day: '2-digit', month: '2-digit', year: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Equipe page ───────────────────────────────────────────────
const TABS = [
  { key: 'gestion', label: 'Gestion', icon: Users },
  { key: 'stats',   label: 'Statistiques', icon: BarChart2 }
];

export default function Equipe() {
  const { user: me } = useAuth();
  const [tab, setTab] = useState('gestion');

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-indigo-600/15 text-indigo-400 flex items-center justify-center flex-shrink-0">
          <Users size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-100">Équipe</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gestion des membres et statistiques</p>
        </div>
      </div>

      <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === key ? 'bg-indigo-600/20 text-slate-100 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
            <Icon size={14} className={tab === key ? 'text-indigo-400' : 'text-slate-600'} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'gestion' ? <GestionTab me={me} /> : <StatsTab />}
    </div>
  );
}
