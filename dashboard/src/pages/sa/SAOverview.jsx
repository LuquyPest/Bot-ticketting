import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { RefreshCw, Loader2, WrenchIcon } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSA } from './SAApp';

const STATUS_LABEL = { active: 'Actif', pending: 'En attente', suspended: 'Suspendu' };
const card = 'glass-dark rounded-2xl border border-overlay/8';

function Kpi({ label, value, sub, to }) {
  const body = (
    <div className={`${card} p-4 h-full ${to ? 'hover:border-overlay/16 transition-colors' : ''}`}>
      <p className="text-[11px] text-ink-4">{label}</p>
      <p className="text-2xl font-bold text-ink-1 tabular-nums mt-1">{value ?? '—'}</p>
      {sub && <p className="text-[11px] text-ink-3 mt-0.5">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-elevated border border-overlay/10 rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="text-ink-1 font-semibold mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="flex items-center gap-2 text-ink-2">
          <span className="w-2 h-2 rounded-xs" style={{ background: p.color }} />
          {p.name} <span className="ml-auto pl-3 text-ink-1 tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function SAOverview() {
  const { saUser } = useSA();
  const isSA = saUser?.type === 'superadmin';
  const [stats, setStats] = useState(null);

  const load = useCallback(() => {
    api.get('/sa/stats').then(r => setStats(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const daily = useMemo(() => (stats?.daily || []).map(d => ({ ...d, label: `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}` })), [stats]);

  if (!stats) return <div className="flex justify-center py-24"><Loader2 size={20} className="animate-spin text-ink-3" /></div>;
  const { guilds, totals } = stats;

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink-1">Vue d'ensemble</h1>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/5" title="Actualiser">
          <RefreshCw size={15} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Serveurs actifs" value={guilds.active} sub={`${guilds.total} au total`} to="/sa/guilds" />
        <Kpi label="En attente d'approbation" value={guilds.pending} sub={guilds.suspended ? `${guilds.suspended} suspendu(s)` : null} to="/sa/guilds" />
        <Kpi label="Tickets ouverts" value={totals.openTickets} sub={`${totals.tickets} au total`} />
        <Kpi label="Ouverts sur 30 jours" value={totals.opened30d} sub={`${totals.closed30d} fermés`} />
        <Kpi label="Membres du staff" value={totals.staff} sub={isSA ? `${stats.managers} manager(s)` : null} />
        {isSA && <Kpi label="Erreurs (24 h)" value={stats.errors24h} to="/sa/errors" />}
      </div>

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-semibold text-ink-1 mb-3">Tickets ouverts et fermés par jour (30 jours)</h2>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={daily} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--color-ink-4)', strokeDasharray: '3 3' }} />
            <Legend formatter={v => <span className="text-xs text-ink-2">{v}</span>} iconType="plainline" iconSize={12} />
            <Line type="monotone" dataKey="opened" name="Ouverts" stroke="var(--viz-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface-card)' }} />
            <Line type="monotone" dataKey="closed" name="Fermés" stroke="var(--viz-2)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface-card)' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="px-5 py-4 border-b border-overlay/6">
          <h2 className="text-sm font-semibold text-ink-1">Serveurs</h2>
        </div>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Serveurs">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-overlay/6">
                {['Serveur', 'Statut', 'Tickets ouverts', 'Staff', 'Tickets (30 j)', 'Note moy.'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-ink-4 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-overlay/4">
              {stats.perGuild.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-4">Aucun serveur</td></tr>
              )}
              {stats.perGuild.map(g => (
                <tr key={g.guild_id} className="hover:bg-overlay/2">
                  <td className="px-4 py-3">
                    <p className="text-sm font-semibold text-ink-1">{g.guild_name}</p>
                    <p className="text-[10px] text-ink-4 font-mono">{g.guild_id}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-2 whitespace-nowrap">
                    {STATUS_LABEL[g.status] || g.status}
                    {g.maintenance_mode && <WrenchIcon size={11} className="inline ml-1.5 text-orange-300" aria-label="Maintenance" />}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">{g.openTickets ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">{g.staff ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">{g.opened30d ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">{g.avgRating != null ? `${g.avgRating} / 5` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
