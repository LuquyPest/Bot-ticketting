import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { RefreshCw, Loader2, Gauge, AlertTriangle, WrenchIcon } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSA } from './SAApp';
import SALimitsModal from './SALimitsModal';

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

// "3 / 10" with a warning tint once the usage reaches 90 % of a non-zero limit.
function Usage({ used, max }) {
  if (used == null) return <span className="text-ink-4">—</span>;
  const near = max > 0 && used >= max * 0.9;
  return (
    <span className={`tabular-nums ${near ? 'text-amber-300 font-semibold' : 'text-ink-2'}`}>
      {used}<span className="text-ink-4"> / {max > 0 ? max : '∞'}</span>
      {near && <AlertTriangle size={11} className="inline ml-1 -mt-0.5" aria-label="Limite presque atteinte" />}
    </span>
  );
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
  const [limitsOf, setLimitsOf] = useState(null);

  const load = useCallback(() => {
    api.get('/sa/stats').then(r => setStats(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const daily = useMemo(() => (stats?.daily || []).map(d => ({ ...d, label: `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}` })), [stats]);

  if (!stats) return <div className="flex justify-center py-24"><Loader2 size={20} className="animate-spin text-ink-3" /></div>;
  const { guilds, totals } = stats;

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      {limitsOf && <SALimitsModal guild={limitsOf} onClose={() => setLimitsOf(null)} onSaved={load} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink-1">Vue d'ensemble</h1>
          <p className="text-sm text-ink-3">Activité de {isSA ? 'tous les serveurs' : 'vos serveurs'}</p>
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
          <h2 className="text-sm font-semibold text-ink-1">Serveurs et limites</h2>
          <p className="text-[11px] text-ink-4">Utilisation par rapport aux limites fixées (∞ = illimité)</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-overlay/6">
                {['Serveur', 'Statut', 'Formule', 'Tickets ouverts', 'Staff', 'Tickets (30 j)', 'Note moy.', 'Transcripts', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-ink-4 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-overlay/4">
              {stats.perGuild.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-ink-4">Aucun serveur</td></tr>
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
                  <td className="px-4 py-3 text-ink-2 whitespace-nowrap">{g.plan_name || <span className="text-ink-4">Personnalisée</span>}</td>
                  <td className="px-4 py-3"><Usage used={g.openTickets} max={g.max_tickets} /></td>
                  <td className="px-4 py-3"><Usage used={g.staff} max={g.max_agents} /></td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">{g.opened30d ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">{g.avgRating != null ? `${g.avgRating} / 5` : '—'}</td>
                  <td className="px-4 py-3 text-ink-2 whitespace-nowrap">{g.transcript_retention_days > 0 ? `${g.transcript_retention_days} j` : 'Illimité'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setLimitsOf(g)} title="Modifier les limites"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/5">
                      <Gauge size={13} /> Limites
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
