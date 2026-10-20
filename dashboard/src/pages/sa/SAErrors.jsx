import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { uiLocale } from '../../i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { RefreshCw, Loader2, Search, Trash2, ChevronDown, ChevronRight, X, BellRing, Send } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../../utils/confirmToast';

const PAGE = 50;
const PERIODS = [[24, '24 h'], [168, '7 jours'], [720, '30 jours'], [0, 'Tout']];
const card = 'glass-dark rounded-2xl border border-overlay/8';
const fmt = d => new Date(d).toLocaleString(uiLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Last 24 hours, one bar per hour (rows: { ago: hours ago, n }).
function hourlySeries(rows) {
  const byAgo = new Map(rows.map(r => [Number(r.ago), Number(r.n)]));
  const out = [];
  for (let ago = 23; ago >= 0; ago--) {
    const d = new Date(Date.now() - ago * 3600000);
    out.push({ label: `${d.getHours()}h`, n: byAgo.get(ago) || 0 });
  }
  return out;
}

// Error spike alert (Discord DM and/or webhook), checked every 5 minutes by the bot.
function AlertSettings() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [ids, setIds] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || cfg) return;
    api.get('/sa/settings/error-alert').then(r => { setCfg(r.data); setIds(r.data.discordUserIds.join(', ')); })
      .catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, [open, cfg]);

  const payload = () => ({
    ...cfg,
    threshold: Number(cfg.threshold), windowMinutes: Number(cfg.windowMinutes), discordDownMinutes: Number(cfg.discordDownMinutes ?? 5),
    discordUserIds: ids.split(/[\s,;]+/).filter(Boolean),
    webhookUrl: cfg.webhookUrl?.trim() || null,
  });
  const save = async () => {
    setBusy(true);
    try { const r = await api.put('/sa/settings/error-alert', payload()); setCfg(r.data); toast.success('Alerte enregistrée'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    try {
      await api.put('/sa/settings/error-alert', payload());
      const r = await api.post('/sa/settings/error-alert/test');
      const wh = r.data.webhook ? (r.data.webhook.status >= 200 && r.data.webhook.status < 300 ? 'webhook OK' : 'webhook en échec') : null;
      toast.success([`${r.data.dm} MP envoyé(s)`, wh].filter(Boolean).join(' · '));
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const input = 'w-full px-3 py-2 rounded-xl bg-overlay/4 border border-overlay/8 text-xs text-ink-1 outline-hidden focus:border-primary/50';

  return (
    <div className="glass-dark rounded-2xl border border-overlay/8">
      <button onClick={() => setOpen(o => !o)} className="w-full px-5 py-3.5 flex items-center gap-2.5 text-left">
        <BellRing size={15} className="text-red-400" />
        <span className="flex-1">
          <span className="text-sm font-semibold text-ink-1">Alerte en cas de pic d'erreurs</span>
          <span className="block text-[11px] text-ink-4">MP Discord et/ou webhook quand les erreurs dépassent un seuil (une alerte par heure au plus)</span>
        </span>
        {open ? <ChevronDown size={14} className="text-ink-4" /> : <ChevronRight size={14} className="text-ink-4" />}
      </button>
      {open && (cfg === null ? (
        <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-ink-3" /></div>
      ) : (
        <div className="px-5 pb-5 space-y-3 border-t border-overlay/6 pt-4">
          <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
            <input type="checkbox" checked={cfg.enabled} onChange={e => setCfg(c => ({ ...c, enabled: e.target.checked }))} />
            Alerte activée
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-[11px] text-ink-3">Seuil (nombre d'erreurs)
              <input type="number" min={1} value={cfg.threshold} onChange={e => setCfg(c => ({ ...c, threshold: e.target.value }))} className={input} />
            </label>
            <label className="space-y-1 text-[11px] text-ink-3">Sur une fenêtre de (minutes)
              <input type="number" min={1} value={cfg.windowMinutes} onChange={e => setCfg(c => ({ ...c, windowMinutes: e.target.value }))} className={input} />
            </label>
          </div>
          <label className="block space-y-1 text-[11px] text-ink-3">Prévenir aussi si le bot est déconnecté de Discord depuis plus de (minutes, 0 = jamais) — indépendant de la case ci-dessus, aux mêmes destinataires ; pendant une coupure, seul le webhook est fiable
            <input type="number" min={0} max={1440} value={cfg.discordDownMinutes ?? 5} onChange={e => setCfg(c => ({ ...c, discordDownMinutes: e.target.value }))} className={input} />
          </label>
          <label className="block space-y-1 text-[11px] text-ink-3">IDs Discord à prévenir en MP (séparés par des virgules)
            <input value={ids} onChange={e => setIds(e.target.value)} placeholder="123456789012345678" className={`${input} font-mono`} />
          </label>
          <label className="block space-y-1 text-[11px] text-ink-3">URL de webhook (Discord ou autre, https)
            <input value={cfg.webhookUrl || ''} onChange={e => setCfg(c => ({ ...c, webhookUrl: e.target.value }))} placeholder="https://discord.com/api/webhooks/…" className={input} />
          </label>
          <div className="flex gap-2 justify-end">
            <button onClick={test} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-ink-2 border border-overlay/8 hover:bg-overlay/5 disabled:opacity-50">
              <Send size={12} /> Envoyer un test
            </button>
            <button onClick={save} disabled={busy} className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-primary hover:bg-primary-light disabled:opacity-50">
              Enregistrer
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorRow({ e, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-3">
        <button onClick={() => setOpen(o => !o)} className="mt-0.5 text-ink-4 hover:text-ink-1" aria-label={open ? 'Replier' : 'Déplier'}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-ink-1 wrap-break-word">{e.message}</p>
          <p className="text-[11px] text-ink-4 mt-0.5 flex flex-wrap gap-x-2">
            <span className="font-mono text-ink-3">{e.context}</span>
            <span>· {e.guild_id ? (e.guild_name || e.guild_id) : 'global'}</span>
            <span>· {fmt(e.created_at)}</span>
          </p>
          {open && (
            <pre className="mt-2 p-3 rounded-lg bg-black/30 border border-overlay/6 text-[11px] text-ink-3 overflow-x-auto whitespace-pre-wrap break-all">
              {e.stack || 'Pas de trace disponible'}
            </pre>
          )}
        </div>
        <button onClick={() => onDelete(e)} title="Supprimer"
          className="p-1.5 rounded-md text-ink-4 hover:text-red-400 hover:bg-red-400/10">
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}

export default function SAErrors() {
  const [filters, setFilters] = useState({ hours: 168, guild_id: '', context: '', q: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [guilds, setGuilds] = useState([]);

  useEffect(() => { api.get('/sa/guilds').then(r => setGuilds(r.data)).catch(() => {}); }, []);
  // Debounced text search
  useEffect(() => {
    const t = setTimeout(() => setFilters(f => (f.q === search ? f : { ...f, q: search })), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(0); }, [filters]);

  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), [filters]);

  const load = useCallback(() => {
    api.get('/sa/error-logs', { params: { ...params, limit: PAGE, offset: page * PAGE } })
      .then(r => setData(r.data))
      .catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, [params, page]);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const hourly = useMemo(() => hourlySeries(data?.hourly || []), [data]);
  const filtered = filters.guild_id || filters.context || filters.q || filters.hours;

  const remove = async (e) => {
    try { await api.delete(`/sa/error-logs/${e.id}`); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const clear = async () => {
    if (!await confirmToast(`Supprimer les ${data.total} erreur(s) ${filtered ? 'correspondant aux filtres' : 'du journal'} ?`)) return;
    try {
      const r = await api.delete('/sa/error-logs', { params });
      toast.success(`${r.data.deleted} erreur(s) supprimée(s)`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  const input = 'px-3 py-2 rounded-xl bg-overlay/4 border border-overlay/8 text-xs text-ink-1 outline-hidden focus:border-primary/50';

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink-1">Erreurs</h1>
          <p className="text-sm text-ink-3">Erreurs du bot, du dashboard et des automatismes, tous serveurs confondus</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/5" title="Actualiser">
          <RefreshCw size={15} />
        </button>
      </div>

      <AlertSettings />

      {!data ? (
        <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-ink-3" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
            <div className={`${card} p-5`}>
              <h2 className="text-sm font-semibold text-ink-1 mb-3">Erreurs par heure (24 h)</h2>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={hourly} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => [v, 'Erreurs']} cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    contentStyle={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="n" fill="var(--viz-2)" radius={[4, 4, 0, 0]} maxBarSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className={`${card} p-5`}>
              <h2 className="text-sm font-semibold text-ink-1 mb-3">Sources fréquentes (7 jours)</h2>
              {data.contexts.length === 0 ? (
                <p className="text-xs text-ink-4 py-4 text-center">Aucune erreur</p>
              ) : (
                <ul className="space-y-1">
                  {data.contexts.map(c => (
                    <li key={c.context}>
                      <button onClick={() => set('context', filters.context === c.context ? '' : c.context)}
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-xs text-left
                                    ${filters.context === c.context ? 'bg-primary/15 text-ink-1' : 'text-ink-2 hover:bg-overlay/4'}`}>
                        <span className="font-mono truncate flex-1" title={c.context}>{c.context}</span>
                        <span className="tabular-nums text-ink-1">{c.n}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 p-1 rounded-xl bg-overlay/4 border border-overlay/6">
              {PERIODS.map(([h, label]) => (
                <button key={h} onClick={() => set('hours', h)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filters.hours === h ? 'bg-primary/15 text-ink-1' : 'text-ink-4 hover:text-ink-2'}`}>
                  {label}
                </button>
              ))}
            </div>
            <select value={filters.guild_id} onChange={e => set('guild_id', e.target.value)} className={input} aria-label="Serveur">
              <option value="">Tous les serveurs</option>
              <option value="none">Global (sans serveur)</option>
              {guilds.map(g => <option key={g.guild_id} value={g.guild_id}>{g.guild_name}</option>)}
            </select>
            <div className={`${input} flex items-center gap-2 flex-1 min-w-48 max-w-xs`}>
              <Search size={13} className="text-ink-4" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher dans les messages…"
                className="flex-1 bg-transparent outline-hidden placeholder-ink-4" />
            </div>
            {filters.context && (
              <button onClick={() => set('context', '')} className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs text-ink-2 bg-overlay/4 border border-overlay/8">
                <span className="font-mono">{filters.context}</span> <X size={12} />
              </button>
            )}
            <button onClick={clear} disabled={!data.total}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-red-400
                         bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-40">
              <Trash2 size={12} /> {filtered ? 'Vider la sélection' : 'Vider le journal'}
            </button>
          </div>

          <div className={`${card} overflow-hidden`}>
            <div className="px-5 py-3 border-b border-overlay/6 text-xs text-ink-3">{data.total} erreur(s)</div>
            {data.rows.length === 0 ? (
              <p className="px-5 py-10 text-xs text-ink-4 text-center">Aucune erreur pour ces filtres</p>
            ) : (
              <ul className="divide-y divide-overlay/4">
                {data.rows.map(e => <ErrorRow key={e.id} e={e} onDelete={remove} />)}
              </ul>
            )}
            {data.total > PAGE && (
              <div className="px-5 py-3 border-t border-overlay/6 flex items-center justify-between text-xs text-ink-3">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg hover:bg-overlay/5 disabled:opacity-40">Précédent</button>
                <span>Page {page + 1} / {Math.ceil(data.total / PAGE)}</span>
                <button disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg hover:bg-overlay/5 disabled:opacity-40">Suivant</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
