import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ticket, CheckCircle, Clock, Star, TrendingUp, TrendingDown } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../api';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import { fmtDuration } from '../utils/format';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useSSE } from '../hooks/useSSE';

function fmtChartDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function buildChart(opened, closed, days) {
  const map = {};
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map[key] = { date: fmtChartDate(d), opened: 0, closed: 0 };
  }
  opened.forEach(r => { if (map[r.date]) map[r.date].opened = r.count; });
  closed.forEach(r => { if (map[r.date]) map[r.date].closed = r.count; });
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

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [recent, setRecent] = useState([]);
  const [days, setDays] = useState(7);
  const navigate = useNavigate();

  const loadData = useCallback(() => {
    api.get('/dashboard/stats').then(r => setStats(r.data)).catch(() => {});
    api.get('/dashboard/recent').then(r => setRecent(r.data)).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useAutoRefresh(loadData);

  // Request notification permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // SSE: reload stats on new ticket, show browser notification
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
      setActivity(buildChart(r.data.opened, r.data.closed, days));
    }).catch(() => {});
  }, [days]);

  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Vue d'ensemble du système de tickets</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Tickets ouverts" value={stats?.openTickets} icon={Ticket} color="indigo" />
        <StatCard label="Tickets fermés" value={stats?.closedTickets} icon={CheckCircle} color="emerald" />
        <StatCard label="Temps de réponse moy." value={fmtDuration(stats?.avgResponseSeconds)} icon={Clock} color="amber" />
        <StatCard
          label="Note moyenne"
          value={stats?.avgRating ? `${stats.avgRating}/5` : '—'}
          icon={Star}
          color="violet"
          sub={stats?.totalRatings ? `${stats.totalRatings} avis` : null}
        />
      </div>

      {/* Chart + recent */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Activity chart */}
        <div className="xl:col-span-2 bg-slate-900 border border-slate-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Activité des tickets</h2>
              <p className="text-[10px] text-slate-600 uppercase tracking-wider font-medium mt-0.5">Ouvertures et fermetures</p>
            </div>
            <div className="flex gap-1 bg-slate-800/60 rounded-lg p-0.5">
              {[7, 14, 30].map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${days === d ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
                >
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
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '11px', color: '#64748b' }} />
              <Area type="monotone" dataKey="opened" name="Ouverts" stroke="#6366f1" fill="url(#gradOpened)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="closed" name="Fermés" stroke="#10b981" fill="url(#gradClosed)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Recent tickets */}
        <div className="bg-slate-900 border border-slate-800/60 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-100 mb-4">Tickets récents</h2>
          <div className="space-y-1">
            {recent.map(t => (
              <button
                key={t.id}
                onClick={() => navigate(`/tickets/${t.id}`)}
                className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/60 transition-colors text-left group"
              >
                <div className="min-w-0 flex-1 mr-2">
                  <p className="text-sm text-slate-300 truncate font-medium group-hover:text-slate-100">{t.owner_tag}</p>
                  <p className="text-xs text-slate-600 truncate">{t.subject || 'Sans sujet'}</p>
                </div>
                <Badge label={t.status} variant={t.status} />
              </button>
            ))}
            {!recent.length && (
              <p className="text-sm text-slate-600 text-center py-6">Aucun ticket récent</p>
            )}
          </div>
        </div>
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
