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
  opened.forEach(r => { if (map[r.date]) map[r.date].opened = r.count; });
  closed.forEach(r => { if (map[r.date]) map[r.date].closed = r.count; });
  unclaimed.forEach(r => { if (map[r.date]) map[r.date].unclaimed = r.count; });
  return Object.values(map);
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700/60 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400 mb-1.5 font-medium">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }} className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: p.color }} />
          {p.name} : <span className="font-semibold ml-0.5">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

const PRIO_COLORS = { low: '#10b981', normal: '#6366f1', urgent: '#ef4444' };
const PRIO_LABELS = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [recent, setRecent] = useState([]);
  const [heatmap, setHeatmap] = useState([]);
  const [topStaff, setTopStaff] = useState([]);
  const [pending, setPending] = useState([]);
  const [days, setDays] = useState(7);
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Vue d'ensemble du système de tickets</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Tickets ouverts"      value={stats?.openTickets}     icon={Ticket}      color="indigo" />
        <StatCard label="Tickets fermés"       value={stats?.closedTickets}   icon={CheckCircle} color="emerald" />
        <StatCard label="Non claim"            value={stats?.unclaimedTickets} icon={AlertTriangle} color="amber"
          sub={stats?.unclaimedTickets > 0 ? 'en attente' : null} />
        <StatCard label="Note moyenne"
          value={stats?.avgRating ? `${stats.avgRating}/5` : '—'}
          icon={Star} color="violet"
          sub={stats?.totalRatings ? `${stats.totalRatings} avis` : null} />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Temps de réponse moy." value={fmtDuration(stats?.avgResponseSeconds)} icon={Clock} color="sky" />
        <StatCard label="Tps de résolution moy." value={fmtDuration(stats?.avgResolutionSeconds)} icon={Target} color="teal" />
        <StatCard label="Taux de claim" value={stats?.claimRate != null ? `${stats.claimRate}%` : '—'} icon={BarChart2} color="indigo" />
        <StatCard label="Ouverts aujourd'hui" value={stats?.openedToday} icon={TrendingUp} color="emerald"
          sub={stats?.closedToday ? `${stats.closedToday} fermés` : null} />
      </div>

      {/* Pending support alert */}
      {pending.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-300">Tickets en attente depuis plus de 4h</h3>
            <span className="ml-auto bg-amber-500/20 text-amber-300 text-xs font-bold px-2 py-0.5 rounded-full">{pending.length}</span>
          </div>
          <div className="space-y-1">
            {pending.slice(0, 5).map(t => {
              const hrs = Math.floor((Date.now() - new Date(t.last_message_at || t.created_at)) / 3600000);
              return (
                <button key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-amber-500/10 text-left">
                  <span className="text-sm text-slate-300 truncate">{t.owner_tag} — {t.subject || 'Sans sujet'}</span>
                  <span className={`text-xs font-bold ml-2 flex-shrink-0 ${hrs >= 24 ? 'text-red-400' : 'text-amber-400'}`}>
                    {hrs >= 24 ? '⚠️' : ''} {hrs}h
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Chart + recent + donut */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Activity chart */}
        <div className="xl:col-span-2 bg-slate-900 border border-slate-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Activité des tickets</h2>
              <p className="text-[10px] text-slate-600 uppercase tracking-wider font-medium mt-0.5">Ouvertures, fermetures, non claim</p>
            </div>
            <div className="flex gap-1 bg-slate-800/60 rounded-lg p-0.5">
              {[7, 14, 30].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${days === d ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>
                  {d}j
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={activity} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradOpened" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradClosed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradUnclaimed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '11px', color: '#64748b' }} />
              <Area type="monotone" dataKey="opened"   name="Ouverts"   stroke="#6366f1" fill="url(#gradOpened)"   strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="closed"   name="Fermés"    stroke="#10b981" fill="url(#gradClosed)"   strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="unclaimed" name="Non claim" stroke="#f59e0b" fill="url(#gradUnclaimed)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Priority donut */}
        <div className="bg-slate-900 border border-slate-800/60 rounded-xl p-5 flex flex-col">
          <h2 className="text-sm font-semibold text-slate-100 mb-4">Répartition priorité</h2>
          {donutData.some(d => d.value > 0) ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                    dataKey="value" paddingAngle={3}>
                    {donutData.map(d => (
                      <Cell key={d.key} fill={PRIO_COLORS[d.key]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-1.5">
                {donutData.map(d => (
                  <div key={d.key} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: PRIO_COLORS[d.key] }} />
                      <span className="text-slate-400">{d.name}</span>
                    </span>
                    <span className="font-semibold text-slate-300">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">Aucun ticket</div>
          )}
        </div>
      </div>

      {/* Top Staff + Recent */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Top 3 staff */}
        <div className="bg-slate-900 border border-slate-800/60 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={15} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-slate-100">Top staff (7 jours)</h2>
          </div>
          {topStaff.length > 0 ? (
            <div className="space-y-3">
              {topStaff.map((s, i) => (
                <div key={s.admin_id} className="flex items-center gap-3">
                  <span className="text-lg w-6 text-center">{['🥇','🥈','🥉'][i]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{s.admin_tag}</p>
                    <p className="text-xs text-slate-500">{s.tickets_closed} fermés · ⭐ {s.avgRating || '—'}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600 text-center py-4">Aucune donnée</p>
          )}
        </div>

        {/* Recent tickets */}
        <div className="xl:col-span-2 bg-slate-900 border border-slate-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-100">Tickets récents</h2>
            <div className="flex gap-1 bg-slate-800/60 rounded-lg p-0.5">
              {[['', 'Tous'], ['open', 'Ouverts'], ['closed', 'Fermés']].map(([v, l]) => (
                <button key={v} onClick={() => setStatusFilter(v)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${statusFilter === v ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            {recent.map(t => (
              <button key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}
                className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/60 transition-colors text-left group">
                <div className="min-w-0 flex-1 mr-2">
                  <p className="text-sm text-slate-300 truncate font-medium group-hover:text-slate-100">{t.owner_tag}</p>
                  <p className="text-xs text-slate-600 truncate">{t.subject || 'Sans sujet'}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {t.priority && t.priority !== 'normal' && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.priority === 'urgent' ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                      {t.priority === 'urgent' ? 'URGENT' : 'FAIBLE'}
                    </span>
                  )}
                  <Badge label={t.status} variant={t.status} />
                </div>
              </button>
            ))}
            {!recent.length && (
              <p className="text-sm text-slate-600 text-center py-6">Aucun ticket récent</p>
            )}
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="bg-slate-900 border border-slate-800/60 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={15} className="text-indigo-400" />
          <h2 className="text-sm font-semibold text-slate-100">Heatmap horaire (30 jours)</h2>
          <span className="text-xs text-slate-600 ml-1">tickets ouverts par heure de la journée</span>
        </div>
        {heatmap.length > 0 ? (
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={heatmap} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
              <XAxis dataKey="hour" tick={{ fill: '#475569', fontSize: 10 }}
                tickFormatter={h => h % 6 === 0 ? `${String(h).padStart(2,'0')}h` : ''}
                axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                formatter={v => [v, 'Tickets']}
                labelFormatter={h => `${String(h).padStart(2,'0')}:00`}
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {heatmap.map(h => (
                  <Cell key={h.hour} fill={`rgba(99,102,241,${0.2 + 0.8 * (h.count / heatMax)})`} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-20 text-slate-600 text-sm">Aucune donnée</div>
        )}
      </div>

      {/* Today summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800/60 rounded-xl p-5 flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center flex-shrink-0">
            <TrendingUp size={17} />
          </div>
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold">Ouverts aujourd'hui</p>
            <p className="text-2xl font-bold text-slate-100 leading-none mt-1">{stats?.openedToday ?? '—'}</p>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800/60 rounded-xl p-5 flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center flex-shrink-0">
            <TrendingDown size={17} />
          </div>
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold">Fermés aujourd'hui</p>
            <p className="text-2xl font-bold text-slate-100 leading-none mt-1">{stats?.closedToday ?? '—'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
