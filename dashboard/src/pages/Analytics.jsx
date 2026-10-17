import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart2, Activity, Users, Shield, Clock, AlertTriangle,
  TrendingUp, CheckCircle, RefreshCw, Star } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, LineChart, Line
} from 'recharts';
import api from '../api';
import {} from '../utils/format';
import Badge from '../components/Badge';
import { SkeletonCard } from '../components/Skeleton';
import { fmtMinutes } from '../components/SlaBadge';

// ── Helpers ───────────────────────────────────────────────────────────────────

const PERIOD_LABELS = { today: "Aujourd'hui", week: '7 jours', month: '30 jours', all: 'Tout' };
const DAYS_FOR_PERIOD = { today: 1, week: 7, month: 30, all: 180 };

function fmtDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function buildVolumeData(opened, closed, days) {
  const map = {};
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map[key] = { date: fmtDate(key), opened: 0, closed: 0 };
  }
  opened.forEach(r => { if (map[r.date]) map[r.date].opened = r.count; });
  closed.forEach(r => { if (map[r.date]) map[r.date].closed = r.count; });
  return Object.values(map);
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${h}h`);

const SLA_COLORS = {
  ok: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  approaching: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  warning: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  critical: 'text-red-400 bg-red-500/10 border-red-500/20',
};
const SLA_LABELS = { ok: 'OK', approaching: 'Bientôt', warning: 'Dépassé', critical: 'Critique' };

const CHART_COLORS = ['#7c6ef3', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6'];

function ChartCard({ title, icon: Icon, children, action }) {
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-primary-light" />
          <h3 className="text-sm font-semibold text-ink-2">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-elevated border border-overlay/10 rounded-xl px-3.5 py-2.5 text-xs shadow-2xl">
      <p className="text-ink-3 mb-2 font-medium">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="flex items-center gap-1.5 py-0.5" style={{ color: p.color }}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-ink-2">{p.name}</span>
          <span className="font-bold ml-auto pl-3 tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function PeriodSelector({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {Object.entries(PERIOD_LABELS).map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all
                     ${value === k
                       ? 'bg-primary/20 text-primary-light border border-primary/30'
                       : 'text-ink-4 hover:text-ink-2 hover:bg-overlay/4'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Tab: Volume & Tendances ───────────────────────────────────────────────────

function TabVolume({ period, onPeriodChange }) {
  const days = DAYS_FOR_PERIOD[period] || 30;
  const [volume, setVolume]     = useState(null);
  const [hourly, setHourly]     = useState(null);
  const [subjects, setSubjects] = useState(null);
  const [trend, setTrend]       = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/analytics/volume?days=${days}`),
      api.get(`/analytics/hourly?days=${days}`),
      api.get(`/analytics/subjects?days=${days}`),
      api.get(`/analytics/response-trend?days=${days}`),
    ]).then(([v, h, s, t]) => {
      setVolume(v.data);
      setHourly(h.data);
      setSubjects(s.data);
      setTrend(t.data);
    }).finally(() => setLoading(false));
  }, [days]);

  if (loading) return <div className="space-y-4">{[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}</div>;

  const volumeData = volume ? buildVolumeData(volume.opened, volume.closed, days) : [];
  const hourlyData = hourly ? hourly.map(h => ({ name: HOUR_LABELS[h.hour], count: h.count })) : [];

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-3">Période d'analyse</p>
        <PeriodSelector value={period} onChange={onPeriodChange} />
      </div>

      {/* Volume chart */}
      <ChartCard title="Volume de tickets" icon={BarChart2}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={volumeData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="gradOpened" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#7c6ef3" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#7c6ef3" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradClosed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="opened" name="Ouverts" stroke="#7c6ef3" fill="url(#gradOpened)" strokeWidth={1.5} dot={false} />
            <Area type="monotone" dataKey="closed" name="Fermés" stroke="#10b981" fill="url(#gradClosed)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Hourly heatmap + subjects side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Hourly */}
        <ChartCard title="Répartition horaire" icon={Clock}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hourlyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#6b7280' }} axisLine={false} tickLine={false}
                interval={2} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Tickets" fill="#7c6ef3" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Subjects pie */}
        <ChartCard title="Répartition par sujet" icon={Activity}>
          {subjects?.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={subjects} dataKey="count" nameKey="subject"
                  cx="40%" cy="50%" outerRadius={70} innerRadius={40}
                  paddingAngle={2}>
                  {subjects.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, n) => [v, n]} />
                <Legend layout="vertical" align="right" verticalAlign="middle"
                  formatter={(v) => <span style={{ fontSize: 11, color: '#9ca3af' }}>{v.slice(0, 18)}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[180px] flex items-center justify-center">
              <p className="text-xs text-ink-4">Aucun sujet configuré</p>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Response time trend */}
      <ChartCard title="Tendance temps de première réponse" icon={TrendingUp}>
        {trend?.length ? (
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false}
                tickFormatter={v => `${v}m`} />
              <Tooltip formatter={(v) => [`${v} min`, 'Moy. réponse']} labelFormatter={fmtDate} />
              <Line type="monotone" dataKey="avgMinutes" name="Avg réponse (min)"
                stroke="#f59e0b" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-ink-4 py-8 text-center">Pas encore assez de données</p>
        )}
      </ChartCard>
    </div>
  );
}

// ── Tab: SLA ──────────────────────────────────────────────────────────────────

function TabSLA() {
  const [tickets, setTickets] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/analytics/sla').then(r => setTickets(r.data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <SkeletonCard />;

  const counts = { ok: 0, approaching: 0, warning: 0, critical: 0 };
  tickets?.forEach(t => { counts[t.slaStatus] = (counts[t.slaStatus] || 0) + 1; });

  return (
    <div className="space-y-5">
      {/* Summary badges */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { key: 'ok', label: 'Dans les délais', icon: CheckCircle },
          { key: 'approaching', label: 'Approche limite', icon: Clock },
          { key: 'warning', label: 'Dépassé', icon: AlertTriangle },
          { key: 'critical', label: 'Critique', icon: AlertTriangle },
        ].map(({ key, label, icon: Icon }) => (
          <div key={key} className={`p-3 rounded-xl border ${SLA_COLORS[key].replace('text-', 'border-').replace('bg-', '').replace(/\s.*/,'')}`}
            style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Icon size={13} className={SLA_COLORS[key].split(' ')[0]} />
              <span className={`text-xs font-bold tabular-nums ${SLA_COLORS[key].split(' ')[0]}`}>{counts[key]}</span>
            </div>
            <p className="text-[10px] text-ink-4">{label}</p>
          </div>
        ))}
      </div>

      {/* Tickets table */}
      <div className="bg-surface-card border border-overlay/6 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-overlay/6">
          <h3 className="text-sm font-semibold text-ink-2">Tickets ouverts — Vue SLA</h3>
          <button onClick={load} className="p-1.5 text-ink-4 hover:text-ink-1 transition-colors rounded-lg hover:bg-overlay/5">
            <RefreshCw size={13} />
          </button>
        </div>
        {tickets?.length === 0 ? (
          <p className="text-sm text-ink-4 text-center py-10">Aucun ticket ouvert</p>
        ) : (
          <div className="divide-y divide-overlay/4">
            {tickets?.map(t => {
              const hours = Math.floor(t.age_minutes / 60);
              const mins = t.age_minutes % 60;
              const age = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
              const sc = SLA_COLORS[t.slaStatus];
              return (
                <div key={t.id}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-overlay/2 transition-colors">
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md border ${sc}`}>
                    {SLA_LABELS[t.slaStatus]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ink-1 truncate">
                      #{t.id} · {t.owner_tag}
                      {t.subject && <span className="text-ink-4"> · {t.subject}</span>}
                    </p>
                    <p className="text-[10px] text-ink-4">
                      {t.claimer_name ? `Claim par ${t.claimer_name}` : 'Non claimmé'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-mono tabular-nums text-ink-3">{age}</p>
                    <Badge variant={t.priority === 'urgent' ? 'danger' : t.priority === 'low' ? 'muted' : 'default'}
                      className="text-[9px]">
                      {t.priority}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Comparatif Staff ─────────────────────────────────────────────────────

function TabStaff() {
  const [period, setPeriod]   = useState('month');
  const [staff, setStaff]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/analytics/staff-compare?period=${period}`)
      .then(r => setStaff(r.data))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-3">Période</p>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {loading ? <SkeletonCard /> : (
        <div className="bg-surface-card border border-overlay/6 rounded-2xl overflow-hidden">
          {staff?.length === 0 ? (
            <p className="text-sm text-ink-4 text-center py-10">Aucune donnée staff pour cette période</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-overlay/6">
                  {['#', 'Staff', 'Tickets', 'Fermetures', 'Note moy.', 'Tps réponse'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-ink-4 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-overlay/4">
                {staff?.map(s => (
                  <tr key={s.userId} className="hover:bg-overlay/2 transition-colors">
                    <td className="px-4 py-3 text-ink-4 font-mono tabular-nums">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold
                                       ${s.rank === 1 ? 'bg-amber-500/20 text-amber-300' :
                                         s.rank === 2 ? 'bg-slate-400/20 text-slate-300' :
                                         s.rank === 3 ? 'bg-orange-600/20 text-orange-400' :
                                         'text-ink-4'}`}>
                        {s.rank}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-ink-1 font-medium truncate max-w-[120px]">{s.username}</p>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-2 font-medium">{s.ticketsHandled}</td>
                    <td className="px-4 py-3 tabular-nums text-ink-2">{s.closures}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {s.avgRating ? (
                        <span className="text-amber-300">★ {parseFloat(s.avgRating).toFixed(1)}</span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-3">
                      {s.avgFirstResponseMin ? `${s.avgFirstResponseMin}m` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Quality: first response, per-stage SLA compliance, satisfaction ──────────

const STAGE_NAME = { open: 'Ouvert', waiting: 'En attente', in_progress: 'En cours' };
const qcard = 'bg-surface-card border border-overlay/6 rounded-2xl p-5';

function Metric({ label, value, sub }) {
  return (
    <div className={qcard}>
      <p className="text-[11px] text-ink-4">{label}</p>
      <p className="text-2xl font-bold text-ink-1 tabular-nums mt-1">{value ?? '—'}</p>
      {sub && <p className="text-[11px] text-ink-3 mt-0.5">{sub}</p>}
    </div>
  );
}

function TabQuality() {
  const [days, setDays] = useState(30);
  const [q, setQ] = useState(null);
  useEffect(() => { setQ(null); api.get('/analytics/quality', { params: { days } }).then(r => setQ(r.data)).catch(() => setQ(false)); }, [days]);
  if (q === null) return <div className="space-y-4">{[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}</div>;
  if (q === false) return <p className="text-sm text-ink-4">Impossible de charger les statistiques.</p>;
  const fr = q.firstResponse;
  const maxN = Math.max(1, ...q.satisfaction.distribution.map(d => d.n));
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${days === d ? 'bg-primary/15 text-primary-light border-primary/40' : 'bg-surface border-overlay/[0.07] text-ink-3 hover:text-ink-1'}`}>
            {d} jours
          </button>
        ))}
      </div>

      <h2 className="text-sm font-semibold text-ink-1">Temps de première réponse</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Médiane" value={fr.medianMinutes != null ? fmtMinutes(fr.medianMinutes) : null} sub={fr.avgMinutes != null ? `moyenne ${fmtMinutes(fr.avgMinutes)}` : null} />
        <Metric label="Répondus en moins d'1 h" value={fr.within1h != null ? `${fr.within1h} %` : null} sub={fr.within4h != null ? `${fr.within4h} % en moins de 4 h` : null} />
        <Metric label="Répondus en moins de 24 h" value={fr.within24h != null ? `${fr.within24h} %` : null} />
        <Metric label="Sans réponse" value={fr.unanswered} sub={`sur ${fr.tickets} ticket(s) ouverts sur la période`} />
      </div>

      <div className={`${qcard} overflow-x-auto`}>
        <h2 className="text-sm font-semibold text-ink-1 mb-1">Respect des délais par étape</h2>
        <p className="text-[11px] text-ink-4 mb-3">Délais définis dans Paramètres ; temps reconstitué à partir des changements d'étape. Les passages en cours et encore dans les délais ne sont pas comptés.</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-ink-4 border-b border-overlay/6">
              {['Étape', 'Délai', 'Passages mesurés', 'Durée médiane', 'Hors délai', 'Respect'].map(h => <th key={h} className="py-2 pr-4 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-overlay/4">
            {q.stages.map(s => (
              <tr key={s.stage}>
                <td className="py-2.5 pr-4 text-ink-1 font-medium">{STAGE_NAME[s.stage]}</td>
                <td className="py-2.5 pr-4 text-ink-2">{s.slaHours ? `${s.slaHours} h` : 'aucun'}</td>
                <td className="py-2.5 pr-4 text-ink-2 tabular-nums">{s.measured}{s.ongoing ? <span className="text-ink-4"> (+{s.ongoing} en cours)</span> : null}</td>
                <td className="py-2.5 pr-4 text-ink-2 tabular-nums">{s.medianMinutes != null ? fmtMinutes(s.medianMinutes) : '—'}</td>
                <td className="py-2.5 pr-4 tabular-nums text-ink-2">{s.slaHours ? s.breached : '—'}</td>
                <td className="py-2.5 pr-4">
                  {s.compliance == null ? <span className="text-ink-4">—</span> : (
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-24 rounded-full bg-overlay/6 overflow-hidden">
                        <span className="block h-full rounded-r-[4px] bg-[var(--viz-1)]" style={{ width: `${s.compliance}%` }} />
                      </span>
                      <span className="text-ink-1 tabular-nums">{s.compliance} %</span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4">
        <div className={qcard}>
          <h2 className="text-sm font-semibold text-ink-1 mb-1">Satisfaction</h2>
          <p className="text-[11px] text-ink-4 mb-3">{q.satisfaction.total} note(s){q.satisfaction.average != null ? ` · moyenne ${q.satisfaction.average} / 5` : ''}</p>
          <ul className="space-y-2">
            {[...q.satisfaction.distribution].reverse().map(d => (
              <li key={d.rating} className="grid grid-cols-[3rem_1fr_2rem] items-center gap-2 text-xs">
                <span className="text-ink-2 flex items-center gap-0.5">{d.rating} <Star size={10} className="text-amber-400" fill="currentColor" /></span>
                <span className="h-2 rounded-r-[4px] bg-[var(--viz-1)]" style={{ width: `${Math.max(2, (d.n / maxN) * 100)}%` }} />
                <span className="text-ink-1 tabular-nums text-right">{d.n}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={qcard}>
          <h2 className="text-sm font-semibold text-ink-1 mb-3">Commentaires des membres</h2>
          {q.satisfaction.comments.length === 0 ? (
            <p className="text-xs text-ink-4">Aucun commentaire sur la période.</p>
          ) : (
            <ul className="space-y-3 max-h-80 overflow-y-auto">
              {q.satisfaction.comments.map(c => (
                <li key={`${c.ticket_id}-${c.rated_at}`} className="text-xs">
                  <p className="text-ink-2 whitespace-pre-wrap break-words">« {c.comment} »</p>
                  <p className="text-[10px] text-ink-4 mt-0.5">
                    {'★'.repeat(c.rating)}{'☆'.repeat(5 - c.rating)} · {c.owner_tag} ·{' '}
                    <a href={`/tickets/${c.ticket_id}`} className="hover:text-primary-light">#{c.ticket_id}{c.subject ? ` — ${c.subject}` : ''}</a> · {fmtDate(c.rated_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'volume', label: 'Volume & Tendances', icon: BarChart2 },
  { id: 'sla',    label: 'Vue SLA',            icon: Shield },
  { id: 'quality', label: 'Qualité',            icon: Star },
  { id: 'staff',  label: 'Comparatif Staff',   icon: Users },
];

export default function Analytics() {
  const [tab, setTab]       = useState('volume');
  const [period, setPeriod] = useState('month');

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1">Analytiques</h1>
        <p className="text-sm text-ink-3 mt-0.5">Performance, SLA et comparatif staff</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-surface-card border border-overlay/6 rounded-xl w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all
                       ${tab === id
                         ? 'bg-primary/15 text-primary-light shadow-inner'
                         : 'text-ink-4 hover:text-ink-2'}`}>
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'volume' && <TabVolume period={period} onPeriodChange={setPeriod} />}
      {tab === 'sla'    && <TabSLA />}
      {tab === 'quality' && <TabQuality />}
      {tab === 'staff'  && <TabStaff />}
    </div>
  );
}
