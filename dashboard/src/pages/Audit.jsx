import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ChevronLeft, ChevronRight, Download, ListTree, BarChart3, X } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../api';
import toast from 'react-hot-toast';
import { fmtDate } from '../utils/format';

// Categorical slots in fixed order (CSS tokens, validated for both themes)
const CATEGORY_ORDER = ['tickets', 'moderation', 'equipe', 'config', 'integrations'];
const CATEGORY_COLOR = { tickets: 'var(--viz-1)', moderation: 'var(--viz-2)', equipe: 'var(--viz-3)', config: 'var(--viz-4)', integrations: 'var(--viz-5)' };
const SOURCE_STYLE = {
  dashboard: 'text-primary-light bg-primary/10 border-primary/25',
  discord:   'text-indigo-300 bg-indigo-500/10 border-indigo-500/25',
  system:    'text-ink-3 bg-overlay/4 border-overlay/10',
  api:       'text-amber-300 bg-amber-500/10 border-amber-500/25',
  sa:        'text-red-300 bg-red-500/10 border-red-500/25',
};
const STAGE = { open: 'Ouvert', waiting: 'En attente', in_progress: 'En cours' };
const PRIORITY = { low: 'Faible', normal: 'Normale', urgent: 'Urgente' };
const EMPTY = { category: '', action: '', source: '', actor: '', ticket: '', from: '', to: '', q: '' };

const quote = s => (s ? `« ${s} »` : '');
const arrow = (a, b) => `${a ?? '—'} → ${b ?? '—'}`;

// Human-readable detail line for a journal entry.
function describe(row) {
  const d = row.details && typeof row.details === 'object' ? row.details : {};
  switch (row.action) {
    case 'ticket_open':     return d.subject ? `Sujet : ${d.subject}` : '';
    case 'ticket_close':    return [d.reason && `Raison : ${d.reason}`, d.transcriptId && `transcript #${d.transcriptId}`].filter(Boolean).join(' · ');
    case 'ticket_reopen':   return d.reason ? `Raison : ${d.reason}` : '';
    case 'ticket_reply':    return `${d.anonymous ? '(anonyme) ' : ''}${quote(d.excerpt)}`;
    case 'ticket_note':
    case 'note_delete':     return [d.author && `de ${d.author}`, quote(d.excerpt)].filter(Boolean).join(' ');
    case 'ticket_assign':   return `Attribué à ${d.assignee || row.target_id}`;
    case 'ticket_unassign': return `${d.assignee || row.target_id} retiré`;
    case 'ticket_stage':    return arrow(STAGE[d.from] || d.from, STAGE[d.to] || d.to);
    case 'ticket_priority': return arrow(PRIORITY[d.from] || d.from, PRIORITY[d.to] || d.to);
    case 'ticket_rename':
    case 'ticket_subject':  return arrow(d.from, d.to);
    case 'ticket_rating':   return `${d.rating}/5${d.staff ? ` · staff : ${d.staff}` : ''}`;
    case 'ticket_escalation': return `Sans réponse depuis ${d.hours} h`;
    case 'participant_add':
    case 'participant_remove': return `Utilisateur ${row.target_id}`;
    case 'ticket_tag_add':
    case 'ticket_tag_remove': return d.tag ? `Tag : ${d.tag}` : '';
    case 'scheduled_create': return `${d.send_at ? `Pour le ${fmtDate(d.send_at, { dateStyle: 'short', timeStyle: 'short' })} · ` : ''}${quote(d.excerpt)}`;
    case 'scheduled_delete':
    case 'scheduled_sent':  return quote(d.excerpt);
    case 'blacklist_add':   return [d.user, d.reason && `raison : ${d.reason}`, d.duration && d.duration !== 'permanent' && `durée : ${d.duration}`].filter(Boolean).join(' · ');
    case 'blacklist_remove': return d.user || row.target_id;
    case 'dashboard_login': return [d.role && `rôle : ${d.role}`, d.ip && `IP : ${d.ip}`].filter(Boolean).join(' · ');
    case 'staff_access_granted': return `${d.user || row.target_id} · ${d.level === 'chief' ? 'chef support' : 'support'}`;
    case 'staff_access_revoked': return d.user || row.target_id;
    case 'founder_add':
    case 'founder_remove':  return d.username || row.target_id;
    case 'user_role_change': return `Utilisateur ${row.target_id} → ${d.role}`;
    case 'grade_assign':
    case 'grade_remove':    return `${d.grade_name || ''} · utilisateur ${row.target_id}`;
    case 'config_update':   return `Champs : ${Object.keys(d).join(', ')}`;
    case 'newsletter_send': return `${d.subject ? `${d.subject} · ` : ''}${d.sent} envoyé(s), ${d.failed} échec(s)`;
    default:
      return Object.entries(d).filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
  }
}

function FilterBar({ filters, setFilter, meta, reset }) {
  const actions = Object.entries(meta.actions || {}).filter(([, a]) => !filters.category || a.category === filters.category);
  const field = 'bg-surface border border-overlay/[0.07] text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2 text-xs focus:outline-hidden focus:border-primary/50';
  const active = Object.values(filters).some(Boolean);
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <select value={filters.category} onChange={e => { setFilter('category', e.target.value); setFilter('action', ''); }} className={field}>
        <option value="">Toutes catégories</option>
        {CATEGORY_ORDER.map(c => <option key={c} value={c}>{meta.categories?.[c] || c}</option>)}
      </select>
      <select value={filters.action} onChange={e => setFilter('action', e.target.value)} className={`${field} max-w-56`}>
        <option value="">Toutes actions</option>
        {actions.map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
      </select>
      <select value={filters.source} onChange={e => setFilter('source', e.target.value)} className={field}>
        <option value="">Toutes sources</option>
        {Object.entries(meta.sources || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input value={filters.actor} onChange={e => setFilter('actor', e.target.value)} placeholder="Acteur (nom ou ID)" className={`${field} w-40`} />
      <input value={filters.ticket} onChange={e => setFilter('ticket', e.target.value)} placeholder="Ticket #" className={`${field} w-24`} />
      <input value={filters.q} onChange={e => setFilter('q', e.target.value)} placeholder="Rechercher dans les détails" className={`${field} w-48`} />
      <input type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)} className={field} title="Du" />
      <input type="date" value={filters.to} onChange={e => setFilter('to', e.target.value)} className={field} title="Au" />
      {active && (
        <button onClick={reset} className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs text-ink-3 hover:text-ink-1 hover:bg-overlay/5">
          <X size={12} /> Réinitialiser
        </button>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label, meta }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter(p => p.value > 0);
  return (
    <div className="bg-surface-elevated border border-overlay/10 rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="text-ink-1 font-semibold mb-1">{label}</p>
      {rows.length === 0 && <p className="text-ink-4">Aucune action</p>}
      {rows.map(p => (
        <p key={p.dataKey} className="flex items-center gap-2 text-ink-2">
          <span className="w-2 h-2 rounded-xs" style={{ background: p.color }} />
          {meta.categories?.[p.dataKey] || p.name} <span className="ml-auto pl-3 text-ink-1 tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

// Horizontal bar list: label · bar · value (values always visible — no reliance on color alone)
function RankList({ items, max }) {
  if (!items.length) return <p className="text-xs text-ink-4 py-4 text-center">Aucune donnée</p>;
  return (
    <ul className="space-y-2">
      {items.map(it => (
        <li key={it.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-xs">
          <span className="text-ink-2 truncate" title={it.label}>{it.label}</span>
          <span className="h-2 rounded-r-[4px] bg-(--viz-1)" style={{ width: `${Math.max(2, (it.n / max) * 100)}%` }} />
          <span className="text-ink-1 tabular-nums">{it.n}</span>
        </li>
      ))}
    </ul>
  );
}

function Analytics({ filters, meta }) {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const params = { days, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
    api.get('/audit/stats', { params }).then(r => setStats(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, [days, filters]);

  const timeline = useMemo(() => (stats?.timeline || []).map(t => ({ ...t, label: t.day.slice(8, 10) + '/' + t.day.slice(5, 7) })), [stats]);
  const usedCategories = CATEGORY_ORDER.filter(c => timeline.some(t => t[c] > 0));
  const card = 'bg-overlay/2.5 rounded-2xl border border-overlay/6 p-5';

  if (!stats) return <div className="flex justify-center py-16"><RefreshCw size={18} className="animate-spin text-ink-4" /></div>;

  const actionItems = stats.actions.slice(0, 10).map(a => ({ key: a.action, label: meta.actions?.[a.action]?.label || a.action, n: a.n }));
  const actorItems = stats.actors.map(a => ({ key: `${a.actor_id}:${a.source}`, label: `${a.actor_tag}${a.source !== 'dashboard' ? ` (${meta.sources?.[a.source] || a.source})` : ''}`, n: a.n }));
  const sourceItems = stats.sources.map(s => ({ key: s.source, label: meta.sources?.[s.source] || s.source, n: s.n })).sort((a, b) => b.n - a.n);
  const busiest = stats.hours.reduce((m, h) => (h.n > m.n ? h : m), { hour: 0, n: 0 });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${days === d ? 'bg-primary/15 text-primary-light border-primary/40' : 'bg-surface border-overlay/[0.07] text-ink-3 hover:text-ink-1'}`}>
            {d} jours
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Actions', stats.total],
          ['Par jour (moy.)', (stats.total / stats.days).toFixed(1)],
          ['Acteurs distincts', new Set(stats.actors.map(a => a.actor_id)).size + (stats.actors.length === 10 ? '+' : '')],
          ['Heure la plus active', busiest.n ? `${busiest.hour} h` : '—'],
        ].map(([label, value]) => (
          <div key={label} className={card}>
            <p className="text-[11px] text-ink-4">{label}</p>
            <p className="text-2xl font-bold text-ink-1 tabular-nums mt-1">{value}</p>
          </div>
        ))}
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-ink-1 mb-3">Actions par jour et par catégorie</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={timeline} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip meta={meta} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Legend formatter={v => <span className="text-xs text-ink-2">{meta.categories?.[v] || v}</span>} iconType="square" iconSize={9} />
            {usedCategories.map((c, i) => (
              <Bar key={c} dataKey={c} stackId="a" fill={CATEGORY_COLOR[c]} stroke="var(--color-surface-card)" strokeWidth={2}
                maxBarSize={28} radius={i === usedCategories.length - 1 ? [4, 4, 0, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={card}>
          <h3 className="text-sm font-semibold text-ink-1 mb-3">Actions les plus fréquentes</h3>
          <RankList items={actionItems} max={actionItems[0]?.n || 1} />
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-ink-1 mb-3">Membres les plus actifs</h3>
          <RankList items={actorItems} max={actorItems[0]?.n || 1} />
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-ink-1 mb-3">Origine des actions</h3>
          <RankList items={sourceItems} max={sourceItems[0]?.n || 1} />
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-ink-1 mb-3">Activité par heure</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={stats.hours} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="hour" tickFormatter={h => `${h}h`} tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} interval={2} />
              <YAxis allowDecimals={false} tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => [v, 'Actions']} labelFormatter={h => `${h} h – ${h + 1} h`}
                contentStyle={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="n" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default function Audit() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('journal');
  const [meta, setMeta] = useState({ actions: {}, categories: {}, sources: {} });
  const [filters, setFilters] = useState(EMPTY);
  const [debounced, setDebounced] = useState(EMPTY);
  const [data, setData] = useState({ rows: [], total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => { api.get('/audit/meta').then(r => setMeta(r.data)).catch(() => {}); }, []);
  // Text filters are debounced so typing does not fire a request per key
  useEffect(() => { const t = setTimeout(() => setDebounced(filters), 300); return () => clearTimeout(t); }, [filters]);

  const params = useMemo(() => Object.fromEntries(Object.entries(debounced).filter(([, v]) => v)), [debounced]);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/audit', { params: { ...params, page } })
      .then(r => setData(r.data))
      .catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'))
      .finally(() => setLoading(false));
  }, [page, params]);

  useEffect(() => { if (tab === 'journal') load(); }, [load, tab]);

  const setFilter = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1); };
  const exportUrl = `/api/audit/export?${new URLSearchParams(params).toString()}`;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Journal d'activité</h1>
          <p className="text-sm text-ink-3 mt-0.5">Toutes les actions du serveur : dashboard, Discord, API, automatismes et super-admin</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 bg-surface rounded-xl p-1 border border-overlay/6">
            {[['journal', 'Journal', ListTree], ['analytics', 'Analytique', BarChart3]].map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${tab === id ? 'bg-primary/15 text-primary-light' : 'text-ink-3 hover:text-ink-1'}`}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          {tab === 'journal' && (
            <>
              <a href={exportUrl} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface border border-overlay/[0.07] text-xs text-ink-3 hover:text-ink-1">
                <Download size={13} /> CSV
              </a>
              <button onClick={load} className="p-2 rounded-xl text-ink-3 hover:text-ink-1 hover:bg-surface" title="Actualiser"><RefreshCw size={15} /></button>
            </>
          )}
        </div>
      </div>

      <FilterBar filters={filters} setFilter={setFilter} meta={meta} reset={() => { setFilters(EMPTY); setPage(1); }} />

      {tab === 'analytics' ? <Analytics filters={params} meta={meta} /> : (
        <>
          <p className="text-xs text-ink-4">{data.total} action(s)</p>
          <div className="bg-overlay/2 rounded-2xl border border-overlay/6 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-overlay/6 text-[10px] uppercase tracking-wider text-ink-4">
                  <th className="text-left px-4 py-3 font-semibold w-36">Date</th>
                  <th className="text-left px-4 py-3 font-semibold w-48">Acteur</th>
                  <th className="text-left px-4 py-3 font-semibold">Action</th>
                  <th className="text-left px-4 py-3 font-semibold w-20">Ticket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-overlay/4">
                {loading ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-ink-4 text-xs">Chargement…</td></tr>
                ) : data.rows.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-ink-4 text-xs">Aucune action pour ces filtres</td></tr>
                ) : data.rows.map(row => {
                  const a = meta.actions?.[row.action];
                  const detail = describe(row);
                  return (
                    <tr key={row.id} className="hover:bg-overlay/2 align-top">
                      <td className="px-4 py-3 text-xs text-ink-3 tabular-nums whitespace-nowrap">{fmtDate(row.created_at, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-ink-1 font-medium truncate">{row.actor_tag}</p>
                        <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-md border ${SOURCE_STYLE[row.source] || SOURCE_STYLE.system}`}>
                          {meta.sources?.[row.source] || row.source}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-ink-1 font-semibold flex items-center gap-2">
                          {a && <span className="w-2 h-2 rounded-xs shrink-0" style={{ background: CATEGORY_COLOR[a.category] }} title={meta.categories?.[a.category]} />}
                          {a?.label || row.action}
                        </p>
                        {detail && <p className="text-xs text-ink-3 mt-0.5 wrap-break-word">{detail}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {row.ticket_id
                          ? <button onClick={() => navigate(`/tickets/${row.ticket_id}`)} className="text-primary-light hover:underline tabular-nums">#{row.ticket_id}</button>
                          : <span className="text-ink-4">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-xs text-ink-3">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg hover:bg-overlay/5 disabled:opacity-40"><ChevronLeft size={14} /></button>
              Page {data.page} / {data.pages}
              <button disabled={page >= data.pages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg hover:bg-overlay/5 disabled:opacity-40"><ChevronRight size={14} /></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
