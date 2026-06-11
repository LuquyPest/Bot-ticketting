import React, { useEffect, useState } from 'react';
import { Star, Clock, Ticket, Users, AlertCircle, TrendingUp, Award, Target, TrendingDown, Minus } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { fmtDate, fmtDuration } from '../utils/format';
import { SkeletonTableRows, SkeletonCard } from '../components/Skeleton';

function StarRating({ value }) {
  if (!value) return <span className="text-ink-4">—</span>;
  const num = parseFloat(value);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {[1,2,3,4,5].map(i => (
          <Star key={i} size={11}
            fill={i <= Math.round(num) ? '#f59e0b' : 'none'}
            className={i <= Math.round(num) ? 'text-amber-400' : 'text-ink-4'} />
        ))}
      </div>
      <span className="text-xs text-ink-2 font-medium">{num.toFixed(1)}</span>
    </div>
  );
}

function PersonalKPI({ label, value, icon: Icon, color }) {
  const colors = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
    amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/20'   },
    violet:  { bg: 'bg-primary/10',     text: 'text-primary-light', border: 'border-primary/20'   },
    sky:     { bg: 'bg-sky-500/10',     text: 'text-sky-400',     border: 'border-sky-500/20'     },
  };
  const c = colors[color] || colors.violet;
  return (
    <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5 shadow-card
                    hover:border-white/[0.1] transition-colors">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[10px] text-ink-4 uppercase tracking-wider font-semibold">{label}</p>
        <div className={`w-8 h-8 rounded-xl ${c.bg} border ${c.border}
                         flex items-center justify-center`}>
          <Icon size={15} className={c.text} />
        </div>
      </div>
      <p className="text-2xl font-bold text-ink-1 tabular-nums leading-none">{value ?? '—'}</p>
    </div>
  );
}

/* Rank evolution indicator */
function RankDelta({ delta }) {
  if (delta === null || delta === undefined) return null;
  if (delta === 0) return (
    <span className="flex items-center gap-0.5 text-[10px] text-ink-4 font-semibold">
      <Minus size={10} /> =
    </span>
  );
  if (delta > 0) return (
    <span className="flex items-center gap-0.5 text-[10px] text-emerald-400 font-semibold">
      <TrendingUp size={10} /> +{delta}
    </span>
  );
  return (
    <span className="flex items-center gap-0.5 text-[10px] text-red-400 font-semibold">
      <TrendingDown size={10} /> {delta}
    </span>
  );
}

/* Compare two sorted lists and compute rank delta (positive = improved) */
function computeDeltas(currentSorted, previousSorted) {
  const prevRanks = {};
  previousSorted.forEach((s, i) => { prevRanks[s.admin_id] = i + 1; });
  const deltas = {};
  currentSorted.forEach((s, i) => {
    const curRank = i + 1;
    const prevRank = prevRanks[s.admin_id];
    deltas[s.admin_id] = prevRank != null ? prevRank - curRank : null;
  });
  return deltas;
}

export default function Staff() {
  const { user } = useAuth();
  const [staff, setStaff] = useState([]);
  const [monthlyStaff, setMonthlyStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('tickets_closed');
  const [period, setPeriod] = useState('all'); // 'all' | 'month'
  const isSupport = user?.role === 'support';

  useEffect(() => {
    Promise.all([
      api.get('/staff'),
      api.get('/staff?period=month').catch(() => ({ data: [] })),
    ])
      .then(([allRes, monthRes]) => {
        setStaff(allRes.data);
        setMonthlyStaff(monthRes.data);
      })
      .catch(err => {
        const msg = err.response?.data?.error || 'Erreur de chargement';
        setError(msg);
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  const currentList = period === 'month' ? monthlyStaff : staff;

  const sorted = [...currentList].sort((a, b) => {
    if (sort === 'avgResponseSeconds') {
      const aVal = a.avgResponseSeconds ?? Infinity;
      const bVal = b.avgResponseSeconds ?? Infinity;
      return aVal - bVal;
    }
    return (b[sort] ?? 0) - (a[sort] ?? 0);
  });

  /* rank deltas: compare current month vs all-time sorted */
  const allTimeSorted = [...staff].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
  const monthlySorted = [...monthlyStaff].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
  const rankDeltas = period === 'month' && monthlyStaff.length > 0 && staff.length > 0
    ? computeDeltas(monthlySorted, allTimeSorted)
    : {};

  /* Find the current user's own stats row */
  const myStats = isSupport ? staff.find(s => s.admin_id === user?.id) : null;
  const myMonthStats = isSupport ? monthlyStaff.find(s => s.admin_id === user?.id) : null;

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="page-header">
          <h1>{isSupport ? 'Mes stats' : 'Staff'}</h1>
          <p>{isSupport ? 'Vos performances personnelles' : `${staff.length} membre(s) actif(s)`}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period toggle */}
          <div className="flex gap-0.5 bg-surface rounded-xl p-0.5 border border-white/[0.06]">
            {[['all', 'Tout'], ['month', 'Ce mois']].map(([v, l]) => (
              <button key={v} onClick={() => setPeriod(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
                            ${period === v
                              ? 'bg-surface-elevated text-ink-1 shadow-sm'
                              : 'text-ink-3 hover:text-ink-2'}`}>
                {l}
              </button>
            ))}
          </div>
          {!isSupport && (
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              className="bg-surface border border-white/[0.07] text-ink-2 rounded-xl px-3 py-1.5 text-xs
                         focus:outline-none focus:border-primary/50 transition-all hover:border-white/[0.12]"
            >
              <option value="tickets_closed">Trier par fermetures</option>
              <option value="tickets_claimed">Trier par claims</option>
              <option value="avgRating">Trier par note</option>
              <option value="avgResponseSeconds">Trier par temps de réponse</option>
            </select>
          )}
        </div>
      </div>

      {/* Personal KPI cards (support view) */}
      {isSupport && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {loading ? (
              Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)
            ) : (
              <>
                <PersonalKPI
                  label={period === 'month' ? 'Fermés ce mois' : 'Tickets fermés'}
                  value={period === 'month' ? myMonthStats?.tickets_closed : myStats?.tickets_closed}
                  icon={Ticket}
                  color="emerald"
                />
                <PersonalKPI
                  label={period === 'month' ? 'Claims ce mois' : 'Tickets claim'}
                  value={period === 'month' ? myMonthStats?.tickets_claimed : myStats?.tickets_claimed}
                  icon={TrendingUp}
                  color="sky"
                />
                <PersonalKPI
                  label="Tps réponse moy."
                  value={(period === 'month' ? myMonthStats : myStats)?.avgResponseSeconds
                    ? fmtDuration((period === 'month' ? myMonthStats : myStats).avgResponseSeconds)
                    : '—'}
                  icon={Clock}
                  color="amber"
                />
                <PersonalKPI
                  label="Note moyenne"
                  value={(period === 'month' ? myMonthStats : myStats)?.avgRating
                    ? `${parseFloat((period === 'month' ? myMonthStats : myStats).avgRating).toFixed(1)}/5`
                    : '—'}
                  icon={Star}
                  color="violet"
                />
              </>
            )}
          </div>

          {/* Progress bar */}
          {!loading && myStats && sorted.length > 1 && (() => {
            const rank = sorted.findIndex(s => s.admin_id === user?.id) + 1;
            if (rank === 0) return null;
            const pct  = Math.round(((sorted.length - rank) / (sorted.length - 1)) * 100);
            const delta = rankDeltas[user?.id];
            return (
              <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5 shadow-card">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Award size={14} className="text-primary-light" />
                    <span className="text-sm font-semibold text-ink-1">Classement équipe</span>
                    {period === 'month' && <span className="text-[10px] text-ink-4 bg-surface px-2 py-0.5 rounded-md border border-white/[0.06]">Ce mois</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {period === 'month' && <RankDelta delta={delta} />}
                    <span className="text-sm font-bold text-ink-1 tabular-nums">
                      #{rank} / {sorted.length}
                    </span>
                  </div>
                </div>
                <div className="h-2 bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-primary-light rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-ink-4 mt-1.5">
                  {rank === 1 ? '🥇 Meilleur performer de l\'équipe !' : `Dans le top ${100 - pct}% de l'équipe`}
                </p>
              </div>
            );
          })()}
        </>
      )}

      {/* Section divider label for fondateur */}
      {!isSupport && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/[0.04]" />
          <span className="text-[10px] text-ink-4 uppercase tracking-wider font-semibold">
            {period === 'month' ? 'Classement mensuel' : 'Classement complet'}
          </span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
      )}

      {/* Table */}
      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">#</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Membre</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Fermetures</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Claims</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Tps réponse moy.</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Note moy.</th>
              {period === 'month' && (
                <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Évolution</th>
              )}
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Activité</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonTableRows rows={6} cols={period === 'month' ? 8 : 7} />
            ) : error ? (
              <tr>
                <td colSpan={period === 'month' ? 8 : 7}>
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20
                                    flex items-center justify-center">
                      <AlertCircle size={20} className="text-red-400" />
                    </div>
                    <p className="text-sm text-red-400 font-medium">{error}</p>
                  </div>
                </td>
              </tr>
            ) : !sorted.length ? (
              <tr>
                <td colSpan={period === 'month' ? 8 : 7}>
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-surface border border-white/[0.06]
                                    flex items-center justify-center">
                      <Users size={20} className="text-ink-4" />
                    </div>
                    <p className="text-sm text-ink-3 font-medium">
                      {period === 'month'
                        ? 'Aucune activité ce mois-ci'
                        : (isSupport ? 'Aucune statistique pour ton compte' : 'Aucune statistique disponible')}
                    </p>
                  </div>
                </td>
              </tr>
            ) : sorted.map((s, i) => {
              const isMe = s.admin_id === user?.id;
              const delta = rankDeltas[s.admin_id];
              return (
                <tr key={s.admin_id}
                  className={`border-b border-white/[0.04] last:border-0 transition-colors
                              ${isMe ? 'bg-primary/5 hover:bg-primary/8' : 'hover:bg-white/[0.025]'}`}>
                  <td className="px-4 py-3.5 text-ink-4 font-mono text-xs tabular-nums">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="text-ink-1 font-semibold text-sm">{s.admin_tag}</p>
                        <p className="text-[10px] text-ink-4 font-mono mt-0.5">{s.admin_id}</p>
                      </div>
                      {isMe && (
                        <span className="text-[9px] font-bold uppercase tracking-wide
                                         bg-primary/10 text-primary-light border border-primary/20
                                         px-1.5 py-0.5 rounded-md ml-1">
                          Vous
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <Ticket size={12} className="text-emerald-400" />
                      <span className="text-ink-1 font-semibold text-sm tabular-nums">{s.tickets_closed}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-ink-2 text-sm tabular-nums">{s.tickets_claimed}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <Clock size={12} className="text-amber-400" />
                      <span className="text-ink-2 text-sm">{fmtDuration(s.avgResponseSeconds)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><StarRating value={s.avgRating} /></td>
                  {period === 'month' && (
                    <td className="px-4 py-3.5">
                      <RankDelta delta={delta} />
                    </td>
                  )}
                  <td className="px-4 py-3.5 text-ink-4 text-xs tabular-nums">
                    {fmtDate(s.updated_at, { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
