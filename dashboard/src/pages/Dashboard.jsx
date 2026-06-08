import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Ticket, CheckCircle, Clock, Star, TrendingUp, TrendingDown,
  AlertTriangle, Target, Users, BarChart2
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell, BarChart, Bar
} from 'recharts';
import api from '../api';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import { SkeletonCard } from '../components/Skeleton';
import { fmtDuration } from '../utils/format';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useSSE } from '../hooks/useSSE';
import { useAuth } from '../App';

function fmtChartDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function buildChart(opened, closed, unclaimed, days) {
  const map = {};
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map[key] = { date: fmtChartDate(d), opened: 0, closed: 0, unclaimed: 0 };
  }
  opened.forEach(r  => { if (map[r.date]) map[r.date].opened   = r.count; });
  closed.forEach(r  => { if (map[r.date]) map[r.date].closed   = r.count; });
  unclaimed.forEach(r => { if (map[r.date]) map[r.date].unclaimed = r.count; });
  return Object.values(map);
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-elevated border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-xs
                    shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
      <p className="text-ink-3 mb-2 font-medium">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="flex items-center gap-1.5 py-0.5" style={{ color: p.color }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-ink-2">{p.name}</span>
          <span className="font-bold ml-auto pl-3 tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

const PRIO_COLORS = { low: '#22d3ee', normal: '#7c6ef3', urgent: '#f43f5e' };
const PRIO_LABELS = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };

export default function Dashboard() {
  const { user } = useAuth();
  const [stats,    setStats]    = useState(null);
  const [activity, setActivity] = useState([]);
  const [recent,   setRecent]   = useState([]);
  const [heatmap,  setHeatmap]  = useState([]);
  const [topStaff, setTopStaff] = useState([]);
  const [pending,  setPending]  = useState([]);
  const [days,     setDays]     = useState(7);
  const [statusFilter, setStatusFilter] = useState('');
  const navigate = useNavigate();

  const loadStats = useCallback(() => {
    api.get('/dashboard/stats').then(r => setStats(r.data)).catch(() => {});
  }, []);

  const loadRecent = useCallback(() => {
    const q = statusFilter ? `?status=${statusFilter}` : '';
    api.get(`/dashboard/recent${q}`).then(r => setRecent(r.data)).catch(() => {});
  }, [statusFilter]);

  const loadData = useCallback(() => {
    loadStats();
    loadRecent();
    api.get('/dashboard/heatmap').then(r => setHeatmap(r.data)).catch(() => {});
    api.get('/dashboard/top-staff').then(r => setTopStaff(r.data)).catch(() => {});
    if (user?.role === 'support') {
      api.get('/dashboard/pending').then(r => setPending(r.data)).catch(() => {});
    }
  }, [loadStats, loadRecent, user?.role]);

  useEffect(() => { loadData(); }, [loadData]);
  useAutoRefresh(loadData);
  useEffect(() => { loadRecent(); }, [statusFilter, loadRecent]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useSSE({
    new_ticket: (data) => {
      loadData();
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Nouveau ticket', {
          body: `${data.ownerTag}${data.subject ? ` — ${data.subject}` : ''}`,
          icon: '/favicon.ico'
        });
      }
    }
  });

  useEffect(() => {
    api.get(`/dashboard/activity?days=${days}`).then(r => {
      setActivity(buildChart(r.data.opened, r.data.closed, r.data.unclaimed || [], days));
    }).catch(() => {});
  }, [days]);

  const donutData = stats?.priorityBreakdown
    ? Object.entries(stats.priorityBreakdown).map(([k, v]) => ({ name: PRIO_LABELS[k], value: v, key: k }))
    : [];

  const heatMax = Math.max(1, ...heatmap.map(h => h.count));

  /* ─── Shared card class ─────────────────────────────────────── */
  const card = 'bg-surface-card border border-white/[0.06] rounded-2xl shadow-card';

  return (
    <div className="p-6 space-y-5">

      {/* Page header */}
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Vue d'ensemble du système de tickets</p>
      </div>

      {/* Stat grid — row 1 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {!stats ? (
          Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatCard label="Tickets ouverts"    value={stats.openTickets}      icon={Ticket}        color="indigo" />
            <StatCard label="Tickets fermés"     value={stats.closedTickets}    icon={CheckCircle}   color="emerald" />
            <StatCard label="Non claim"          value={stats.unclaimedTickets} icon={AlertTriangle} color="amber"
              sub={stats.unclaimedTickets > 0 ? 'en attente' : null} />
            <StatCard label="Note moyenne"
              value={stats.avgRating ? `${stats.avgRating}/5` : '—'}
              icon={Star} color="violet"
              sub={stats.totalRatings ? `${stats.totalRatings} avis` : null} />
          </>
        )}
      </div>

      {/* Stat grid — row 2 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {!stats ? (
          Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatCard label="Tps de réponse moy."   value={fmtDuration(stats.avgResponseSeconds)}  icon={Clock}    color="sky" />
            <StatCard label="Tps de résolution moy." value={fmtDuration(stats.avgResolutionSeconds)} icon={Target}  color="teal" />
            <StatCard label="Taux de claim"         value={stats.claimRate != null ? `${stats.claimRate}%` : '—'} icon={BarChart2} color="indigo" />
            <StatCard label="Ouverts aujourd'hui"   value={stats.openedToday}   icon={TrendingUp}   color="emerald"
              sub={stats.closedToday ? `${stats.closedToday} fermés` : null} />
          </>
        )}
      </div>

      {/* Pending support alert */}
      {pending.length > 0 && (
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-4 animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={15} className="text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-300">Tickets en attente depuis plus de 4h</h3>
            <span className="ml-auto bg-amber-500/15 text-amber-300 text-xs font-bold px-2 py-0.5 rounded-full border border-amber-500/20">
              {pending.length}
            </span>
          </div>
          <div className="space-y-0.5">
            {pending.slice(0, 5).map(t => {
              const hrs = Math.floor((Date.now() - new Date(t.last_message_at || t.created_at)) / 3600000);
              return (
                <button key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl
                             hover:bg-amber-500/8 text-left transition-colors">
                  <span className="text-sm text-ink-2 truncate">{t.owner_tag} — {t.subject || 'Sans sujet'}</span>
                  <span className={`text-xs font-bold ml-2 flex-shrink-0 tabular-nums
                                   ${hrs >= 24 ? 'text-red-400' : 'text-amber-400'}`}>
                    {hrs}h
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Chart + donut */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Activity chart */}
        <div className={`xl:col-span-2 ${card} p-5`}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-ink-1">Activité des tickets</h2>
              <p className="text-[10px] text-ink-4 uppercase tracking-wider font-medium mt-0.5">
                Ouvertures · Fermetures · Non claim
              </p>
            </div>
            <div className="flex gap-0.5 bg-surface rounded-xl p-0.5 border border-white/[0.06]">
              {[7, 14, 30].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
                              ${days === d
                                ? 'bg-surface-elevated text-ink-1 shadow-sm'
                                : 'text-ink-3 hover:text-ink-2'}`}>
                  {d}j
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={activity} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gOpened"   x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#7c6ef3" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c6ef3" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gClosed"   x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gUnclaimed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={{ fill: '#54546a', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#54546a', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '11px', color: '#54546a' }} />
              <Area type="monotone" dataKey="opened"    name="Ouverts"   stroke="#7c6ef3" fill="url(#gOpened)"    strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="closed"    name="Fermés"    stroke="#10b981" fill="url(#gClosed)"    strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="unclaimed" name="Non claim" stroke="#f59e0b" fill="url(#gUnclaimed)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Priority donut */}
        <div className={`${card} p-5 flex flex-col`}>
          <h2 className="text-sm font-semibold text-ink-1 mb-4">Répartition priorité</h2>
          {donutData.some(d => d.value > 0) ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={46} outerRadius={68}
                    dataKey="value" paddingAngle={3} stroke="none">
                    {donutData.map(d => (
                      <Cell key={d.key} fill={PRIO_COLORS[d.key]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, n) => [v, n]}
                    contentStyle={{
                      background: '#1a1a2c', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 12, fontSize: 12, color: '#f1f0ff'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-2">
                {donutData.map(d => (
                  <div key={d.key} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PRIO_COLORS[d.key] }} />
                      <span className="text-ink-2">{d.name}</span>
                    </span>
                    <span className="font-semibold text-ink-1 tabular-nums">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-ink-4 text-sm">
              Aucun ticket
            </div>
          )}
        </div>
      </div>

      {/* Top staff + recent tickets */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Top 3 staff */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-4">
            <Users size={14} className="text-primary-light" />
            <h2 className="text-sm font-semibold text-ink-1">Top staff (7 jours)</h2>
          </div>
          {topStaff.length > 0 ? (
            <div className="space-y-2.5">
              {topStaff.map((s, i) => (
                <div key={s.admin_id}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-surface hover:bg-surface-hover
                             border border-white/[0.04] transition-colors">
                  <span className="text-lg w-7 text-center leading-none">
                    {['🥇','🥈','🥉'][i]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-1 truncate">{s.admin_tag}</p>
                    <p className="text-xs text-ink-3 mt-0.5">
                      {s.tickets_closed} fermés
                      {s.avgRating ? ` · ⭐ ${s.avgRating}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-4 text-center py-6">Aucune donnée</p>
          )}
        </div>

        {/* Recent tickets */}
        <div className={`xl:col-span-2 ${card} p-5`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink-1">Tickets récents</h2>
            <div className="flex gap-0.5 bg-surface rounded-xl p-0.5 border border-white/[0.06]">
              {[['', 'Tous'], ['open', 'Ouverts'], ['closed', 'Fermés']].map(([v, l]) => (
                <button key={v} onClick={() => setStatusFilter(v)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
                              ${statusFilter === v
                                ? 'bg-surface-elevated text-ink-1 shadow-sm'
                                : 'text-ink-3 hover:text-ink-2'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-0.5">
            {recent.map(t => (
              <button key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl
                           hover:bg-white/[0.03] transition-colors text-left group">
                <div className="min-w-0 flex-1 mr-3">
                  <p className="text-sm text-ink-2 truncate font-medium group-hover:text-ink-1 transition-colors">
                    {t.owner_tag}
                  </p>
                  <p className="text-xs text-ink-4 truncate mt-0.5">{t.subject || 'Sans sujet'}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {t.priority && t.priority !== 'normal' && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md
                                     ${t.priority === 'urgent'
                                       ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                       : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'}`}>
                      {t.priority === 'urgent' ? 'URGENT' : 'FAIBLE'}
                    </span>
                  )}
                  <Badge label={t.status} variant={t.status} />
                </div>
              </button>
            ))}
            {!recent.length && (
              <p className="text-sm text-ink-4 text-center py-8">Aucun ticket récent</p>
            )}
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={14} className="text-primary-light" />
          <h2 className="text-sm font-semibold text-ink-1">Heatmap horaire</h2>
          <span className="text-xs text-ink-4 ml-1">tickets ouverts par heure — 30 derniers jours</span>
        </div>
        {heatmap.length > 0 ? (
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={heatmap} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
              <XAxis dataKey="hour" tick={{ fill: '#54546a', fontSize: 10 }}
                tickFormatter={h => h % 6 === 0 ? `${String(h).padStart(2,'0')}h` : ''}
                axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#54546a', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                formatter={v => [v, 'Tickets']}
                labelFormatter={h => `${String(h).padStart(2,'0')}:00`}
                contentStyle={{
                  background: '#1a1a2c', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12, fontSize: 12, color: '#f1f0ff'
                }}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {heatmap.map(h => (
                  <Cell key={h.hour} fill={`rgba(124,110,243,${0.2 + 0.75 * (h.count / heatMax)})`} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-20 text-ink-4 text-sm">Aucune donnée</div>
        )}
      </div>

      {/* Today summary — bento 2-col */}
      <div className="grid grid-cols-2 gap-4">
        <div className={`${card} p-5 flex items-center gap-4`}>
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary-light
                          flex items-center justify-center flex-shrink-0">
            <TrendingUp size={18} />
          </div>
          <div>
            <p className="text-[10px] text-ink-4 uppercase tracking-wider font-semibold">Ouverts aujourd'hui</p>
            <p className="text-3xl font-bold text-ink-1 leading-none mt-1 tabular-nums">
              {stats?.openedToday ?? '—'}
            </p>
          </div>
        </div>
        <div className={`${card} p-5 flex items-center gap-4`}>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400
                          flex items-center justify-center flex-shrink-0">
            <TrendingDown size={18} />
          </div>
          <div>
            <p className="text-[10px] text-ink-4 uppercase tracking-wider font-semibold">Fermés aujourd'hui</p>
            <p className="text-3xl font-bold text-ink-1 leading-none mt-1 tabular-nums">
              {stats?.closedToday ?? '—'}
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
