import React, { useCallback, useEffect, useState } from 'react';
import { uiLocale } from '../../i18n';
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertTriangle, ArrowUpCircle, ExternalLink, HardDriveDownload } from 'lucide-react';
import api from '../../api';
import InstanceEmailCard from '../../components/InstanceEmailCard';
import toast from 'react-hot-toast';

const card = 'glass-dark rounded-2xl border border-overlay/8 p-5';
const fmtDur = s => (s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 86400)} j ${Math.floor((s % 86400) / 3600)} h`);
const fmtTime = t => (t ? new Date(t).toLocaleString(uiLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

// State shown with an icon and a word, never color alone
function State({ ok, warn, label }) {
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  const cls = ok ? 'text-emerald-400' : warn ? 'text-amber-300' : 'text-red-400';
  return <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${cls}`}><Icon size={15} aria-hidden="true" />{label}</span>;
}

// Demonstration server: on/off and reset of its fictitious data
function DemoCard() {
  const [demo, setDemo] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/instance/demo').then(r => setDemo(r.data)).catch(() => {}); }, []);
  if (!demo) return null;
  const toggle = async () => { try { const r = await api.put('/instance/demo', { enabled: !demo.enabled }); setDemo(r.data); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const reset = async () => {
    setBusy(true);
    try { const r = await api.post('/instance/demo/reset'); toast.success(`Démo réinitialisée (${r.data.tickets} tickets)`); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <div className="glass-dark rounded-2xl border border-overlay/8 px-5 py-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-1">Serveur de démonstration {demo.enabled ? <span className="text-emerald-400 text-xs">· activé</span> : <span className="text-ink-4 text-xs">· désactivé</span>}</p>
      </div>
      <button onClick={toggle} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1">{demo.enabled ? 'Désactiver' : 'Activer'}</button>
      <button onClick={reset} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">{busy ? 'Réinitialisation…' : 'Réinitialiser maintenant'}</button>
    </div>
  );
}

// Prometheus endpoint: off by default; turning it on creates a token shown once
function MetricsCard() {
  const [m, setM] = useState(null);
  const [token, setToken] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/instance/metrics').then(r => setM(r.data)).catch(() => {}); }, []);
  if (!m || typeof m.enabled !== 'boolean') return null;
  const change = async enabled => {
    if (m.enabled && !window.confirm(enabled ? 'Créer un nouveau jeton ? L\'ancien cessera de fonctionner.' : 'Couper les métriques ? Le jeton actuel cessera de fonctionner.')) return;
    setBusy(true);
    try {
      const r = await api.put('/instance/metrics', { enabled });
      setToken(r.data.token || null);
      setM(v => ({ ...v, enabled: r.data.enabled, createdAt: r.data.enabled ? Date.now() : null }));
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const copy = () => navigator.clipboard?.writeText(token).then(() => toast.success('Jeton copié')).catch(() => {});
  return (
    <div className="glass-dark rounded-2xl border border-overlay/8 px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-1">Métriques Prometheus {m.enabled ? <span className="text-emerald-400 text-xs">· activées</span> : <span className="text-ink-4 text-xs">· désactivées</span>}</p>
          <p className="text-xs text-ink-3 mt-0.5">Pour Prometheus, Grafana ou Uptime Kuma : tickets ouverts, file d'attente, Discord, base, Redis, sauvegardes. Uniquement des chiffres.</p>
        </div>
        {m.enabled && <button onClick={() => change(true)} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Nouveau jeton</button>}
        <button onClick={() => change(!m.enabled)} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">{m.enabled ? 'Désactiver' : 'Activer'}</button>
      </div>
      {m.enabled && (
        <p className="text-xs text-ink-3">Adresse : <code className="text-ink-2" translate="no">{m.url}</code>{m.createdAt ? ` · jeton créé le ${fmtTime(m.createdAt)}` : ''}</p>
      )}
      {token && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2" role="status">
          <p className="text-xs font-semibold text-amber-300">Copie ce jeton maintenant : il ne sera plus jamais affiché.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-0 break-all text-xs text-ink-1 bg-surface rounded-lg px-2 py-1.5" translate="no">{token}</code>
            <button onClick={copy} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1">Copier</button>
          </div>
          <pre className="text-[11px] text-ink-3 bg-surface rounded-lg p-2 overflow-x-auto" translate="no" tabIndex={0}>{`scrape_configs:
  - job_name: ticketbot
    scheme: https
    authorization:
      credentials: ${token}
    static_configs:
      - targets: ['${(m.url || '').replace(/^https?:\/\//, '').replace(/\/metrics$/, '')}']`}</pre>
        </div>
      )}
    </div>
  );
}

const fmtBytes = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`);
const ago = t => (t ? fmtDur(Math.max(60, Math.round((Date.now() - t) / 1000))) : null);

// Running version, latest release, one-click update through the updater service
function VersionCard() {
  const [u, setU] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/instance/update').then(r => setU(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const running = u?.status && ['requested', 'running'].includes(u.status.state);
  // While an update runs, the bot restarts: poll until it answers with the new state
  useEffect(() => { if (!running) return undefined; const t = setInterval(load, 5000); return () => clearInterval(t); }, [running, load]);
  if (!u) return null;
  const check = async () => {
    setBusy(true);
    try { const r = await api.post('/instance/update/check'); setU(r.data); toast.success(r.data.available ? `${r.data.latest} disponible` : 'Tu as la dernière version'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const update = async () => {
    if (!window.confirm(`Mettre à jour vers ${u.latest} ? Le bot redémarre (environ une minute).`)) return;
    try { await api.post('/instance/update'); toast.success('Mise à jour lancée'); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const st = u.status;
  return (
    <div className={card}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-ink-4 mb-1">Version</p>
          <p className="text-sm font-semibold text-ink-1">
            {u.current}
            {u.available ? <span className="ml-2 text-primary-light">→ {u.latest} disponible</span>
              : u.latest ? <span className="ml-2 text-emerald-400 text-xs font-medium">à jour</span> : null}
          </p>
          <p className="text-[11px] text-ink-3 mt-1">
            {u.checkDisabled ? 'Vérification désactivée (UPDATE_CHECK=off).'
              : u.checkedAt ? `Vérifié il y a ${ago(u.checkedAt)}.` : 'Pas encore vérifié.'}
            {u.url && <> <a href={u.url} target="_blank" rel="noopener noreferrer" className="text-primary-light hover:underline inline-flex items-center gap-0.5">Notes de version <ExternalLink size={10} aria-hidden="true" /></a></>}
          </p>
        </div>
        {!u.checkDisabled && <button onClick={check} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">{busy ? 'Vérification…' : 'Vérifier'}</button>}
        {u.available && u.updater.connected && !u.updater.pinned && !running && (
          <button onClick={update} className="px-3 py-1.5 rounded-lg text-xs bg-primary text-white hover:bg-primary-light inline-flex items-center gap-1.5"><ArrowUpCircle size={13} aria-hidden="true" />Mettre à jour</button>
        )}
      </div>
      {running && <p className="mt-3 text-xs text-amber-300 inline-flex items-center gap-1.5" role="status"><Loader2 size={12} className="animate-spin" aria-hidden="true" />Mise à jour vers {st.to} en cours : le bot redémarre, cette page se recharge seule.</p>}
      {st?.state === 'done' && <p className="mt-3 text-xs text-emerald-400">Dernière mise à jour réussie ({st.from} → {st.now}), il y a {ago(st.at)}.</p>}
      {st?.state === 'failed' && (
        <details className="mt-3 text-xs"><summary className="text-red-400 cursor-pointer">La dernière mise à jour a échoué — voir le détail</summary>
          <pre className="mt-2 p-2 rounded-lg bg-overlay/4 text-ink-2 whitespace-pre-wrap max-h-48 overflow-auto">{st.log || '—'}</pre></details>
      )}
      {u.available && !u.updater.connected && (
        <p className="mt-3 text-[11px] text-ink-3">Pour mettre à jour : <code className="text-ink-2">docker compose pull && docker compose up -d</code> sur le serveur. Pour un bouton ici, ajoute le service <code className="text-ink-2">docker-compose.updater.yml</code> (<a href="https://docs.bot.daryu.xyz/guide/mise-a-jour" target="_blank" rel="noopener noreferrer" className="text-primary-light hover:underline">guide</a>).</p>
      )}
      {u.available && u.updater.pinned && <p className="mt-3 text-[11px] text-ink-3">Version épinglée : <code className="text-ink-2">DATICK_VERSION={u.updater.pinned}</code> dans .env. Remplace-la par <code className="text-ink-2">latest</code> ou par la nouvelle version.</p>}
    </div>
  );
}

// Last backup, last check of an archive, last off-site copy (status files of the backup services)
function BackupsCard({ b }) {
  if (!b?.configured) {
    return (
      <div className={card}>
        <p className="text-[11px] text-ink-4 mb-1">Sauvegardes</p>
        <p className="text-sm text-ink-2">Service de sauvegarde absent.</p>
        <p className="text-[11px] text-ink-3 mt-1">Ajoute <code className="text-ink-2">docker-compose.backup.yml</code> à COMPOSE_FILE (<a href="https://docs.bot.daryu.xyz/guide/sauvegardes" target="_blank" rel="noopener noreferrer" className="text-primary-light hover:underline">guide</a>).</p>
      </div>
    );
  }
  const row = (label, s, empty, detail) => (
    <li className="flex flex-wrap items-center justify-between gap-2 bg-overlay/3 rounded-lg px-3 py-2">
      <span className="text-ink-2">{label}</span>
      {!s ? <span className="text-ink-4">{empty}</span>
        : s.ok ? <span className="inline-flex items-center gap-2"><State ok label="OK" /><span className="text-ink-3">il y a {ago(s.at)}{detail ? ` · ${detail(s)}` : ''}</span></span>
          : <span title={s.message}><State label={`Échec il y a ${ago(s.at)}`} /></span>}
    </li>
  );
  return (
    <div className={card}>
      <h2 className="text-sm font-semibold text-ink-1 mb-3 inline-flex items-center gap-2"><HardDriveDownload size={15} aria-hidden="true" />Sauvegardes</h2>
      {b.problems.length > 0 && <div role="alert" className="mb-3"><ul className="text-xs text-amber-300 space-y-1">{b.problems.map(p => <li key={p.key}>{p.text}</li>)}</ul></div>}
      <ul className="space-y-1.5 text-xs">
        {row('Dernière sauvegarde chiffrée', b.backup, 'aucune pour l\'instant', s => fmtBytes(s.bytes))}
        {row('Vérification d\'une archive', b.verify, 'désactivée (BACKUP_VERIFY)', null)}
        {row('Copie hors du serveur', b.offsite, 'non configurée', s => s.remote || null)}
      </ul>
    </div>
  );
}

// Restoring one Discord server from a nightly archive (done by the backup service)
function RestoreCard() {
  const [st, setSt] = useState(null);
  const [guilds, setGuilds] = useState([]);
  const [archive, setArchive] = useState('');
  const [guildId, setGuildId] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/instance/restore').then(r => setSt(r.data)).catch(() => {}), []);
  useEffect(() => {
    load();
    api.get('/instance/guilds').then(r => setGuilds(r.data.filter(g => g.status === 'active'))).catch(() => {});
  }, [load]);
  // While a restore runs, its result is fetched every 3 seconds
  useEffect(() => { if (!st?.pending) return undefined; const t = setInterval(load, 3000); return () => clearInterval(t); }, [st?.pending, load]);
  if (!st?.archives) return null;
  const nameOf = id => guilds.find(g => g.guild_id === id)?.guild_name || id;
  const act = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); await load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const start = () => act(async () => { await api.post('/instance/restore', { archive, guildId, confirm }); setConfirm(''); }, null);
  const rollback = id => window.confirm(`Annuler la restauration de ${nameOf(id)} ? Ses tables d'avant reviennent, celles restaurées sont gardées à leur place.`)
    && act(() => api.post(`/instance/restore/${id}/rollback`), 'Restauration annulée');
  const dropPrev = id => window.confirm(`Supprimer définitivement la copie d'avant restauration de ${nameOf(id)} ?`)
    && act(() => api.delete(`/instance/restore/${id}/previous`), 'Copie supprimée');
  const select = 'w-full bg-surface border border-overlay/8 rounded-lg px-2.5 py-1.5 text-xs text-ink-1';
  return (
    <div className={card}>
      <h2 className="text-sm font-semibold text-ink-1 mb-1">Restaurer un serveur</h2>
      <p className="text-xs text-ink-3 mb-3">Remet un seul serveur Discord dans l'état d'une sauvegarde ; les autres ne bougent pas. Ses données d'avant sont gardées : la restauration s'annule tant que la copie existe.</p>
      {!st.available ? (
        <p className="text-xs text-ink-3">Indisponible : le service de sauvegarde n'est pas installé ou pas à jour (<code className="text-ink-2">docker compose restart backup</code> après la mise à jour).</p>
      ) : st.pending ? (
        <p className="text-xs text-ink-2 inline-flex items-center gap-2" role="status"><Loader2 size={13} className="animate-spin" />Restauration de {nameOf(st.pending.guildId)} depuis {st.pending.archive}…</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink-3">Sauvegarde
            <select value={archive} onChange={e => setArchive(e.target.value)} className={`${select} mt-1`}>
              <option value="">Choisir…</option>
              {st.archives.map(a => <option key={a.file} value={a.file}>{fmtTime(a.at)} · {fmtBytes(a.bytes)}</option>)}
            </select>
          </label>
          <label className="text-xs text-ink-3">Serveur
            <select value={guildId} onChange={e => { setGuildId(e.target.value); setConfirm(''); }} className={`${select} mt-1`}>
              <option value="">Choisir…</option>
              {guilds.map(g => <option key={g.guild_id} value={g.guild_id}>{g.guild_name || g.guild_id}</option>)}
            </select>
          </label>
          {archive && guildId && (
            <>
              <label className="text-xs text-ink-3 sm:col-span-2">Pour confirmer, recopie l'identifiant du serveur : <code className="text-ink-2" translate="no">{guildId}</code>
                <input value={confirm} onChange={e => setConfirm(e.target.value.trim())} inputMode="numeric" className={`${select} mt-1`} />
              </label>
              <div className="sm:col-span-2">
                <button onClick={start} disabled={busy || confirm !== guildId}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600/15 text-red-300 border border-red-600/30 hover:bg-red-600/25 disabled:opacity-50">
                  Restaurer {nameOf(guildId)}
                </button>
              </div>
            </>
          )}
          {!st.archives.length && <p className="text-xs text-ink-4 sm:col-span-2">Aucune archive pour l'instant.</p>}
        </div>
      )}
      {st.last && (
        <p className={`text-xs mt-3 ${st.last.ok ? 'text-emerald-400' : 'text-red-400'}`} role="status">
          {st.last.ok ? 'Dernière restauration' : 'Dernière restauration échouée'} : {nameOf(st.last.guildId)}, {fmtTime(st.last.at)} — {st.last.message}
        </p>
      )}
      {st.previous.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {st.previous.map(id => (
            <li key={id} className="flex flex-wrap items-center gap-2 bg-overlay/3 rounded-lg px-3 py-2">
              <span className="flex-1 min-w-0 text-ink-2">Copie d'avant restauration : {nameOf(id)}</span>
              <button onClick={() => rollback(id)} disabled={busy} className="px-2.5 py-1 rounded-md border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Annuler la restauration</button>
              <button onClick={() => dropPrev(id)} disabled={busy} className="px-2.5 py-1 rounded-md border border-overlay/8 text-ink-3 hover:text-red-400 disabled:opacity-50">Supprimer la copie</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Health() {
  const [h, setH] = useState(null);
  const load = useCallback(() => {
    api.get('/instance/health').then(r => setH(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  if (!h) return <div className="flex justify-center py-24"><Loader2 size={20} className="animate-spin text-ink-3" /></div>;
  // A job is late when its next run is more than 2 minutes in the past
  const late = (h.jobs?.jobs || []).filter(j => j.next && h.now - j.next > 120000);
  const failed = (h.jobs?.jobs || []).filter(j => j.last && !j.last.ok);
  const outdated = h.schemas.guilds.filter(g => g.version !== h.schemas.latest);

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink-1">Santé</h1>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/5" title="Actualiser"><RefreshCw size={15} /></button>
      </div>

      <VersionCard />

      <DemoCard />

      <MetricsCard />

      <InstanceEmailCard />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className={card}>
          <p className="text-[11px] text-ink-4 mb-1">Discord</p>
          <State ok={h.discord.ok} label={h.discord.status} />
          <p className="text-[11px] text-ink-3 mt-1">{h.discord.pingMs != null ? `latence ${h.discord.pingMs} ms · ` : ''}{h.discord.guilds} serveur(s)</p>
        </div>
        <div className={card}>
          <p className="text-[11px] text-ink-4 mb-1">Base de données</p>
          <State ok={h.database.ok} label={h.database.ok ? 'OK' : 'Injoignable'} />
          <p className="text-[11px] text-ink-3 mt-1">{h.database.ok ? `réponse en ${h.database.ms} ms` : h.database.error}</p>
        </div>
        <div className={card}>
          <p className="text-[11px] text-ink-4 mb-1">Redis</p>
          <State ok={h.redis.ok} label={h.redis.ok ? 'OK' : 'Injoignable'} />
          <p className="text-[11px] text-ink-3 mt-1">{h.redis.ok ? `réponse en ${h.redis.ms} ms` : h.redis.error}</p>
        </div>
        <div className={card}>
          <p className="text-[11px] text-ink-4 mb-1">Processus</p>
          <p className="text-sm font-semibold text-ink-1">En ligne depuis {fmtDur(h.process.uptimeS)}</p>
          <p className="text-[11px] text-ink-3 mt-1">mémoire {h.process.rssMb} Mo (tas {h.process.heapMb} Mo) · Node {h.process.node}</p>
        </div>
      </div>

      <div className={`${card} overflow-x-auto`} tabIndex={0} role="region" aria-label="Tâches planifiées">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-ink-1">Tâches planifiées</h2>
          {h.jobs?.counts && (
            <p className="text-[11px] text-ink-3">en attente {h.jobs.counts.waiting} · en cours {h.jobs.counts.active} · différées {h.jobs.counts.delayed} · échecs conservés {h.jobs.counts.failed}</p>
          )}
        </div>
        {(late.length > 0 || failed.length > 0) && (
          <p className="text-xs text-amber-300 mb-3" role="alert">
            {late.length > 0 && `${late.length} tâche(s) en retard. `}{failed.length > 0 && `${failed.length} tâche(s) en échec à leur dernière exécution.`}
          </p>
        )}
        {h.jobs?.error ? <p className="text-xs text-red-400">{h.jobs.error}</p> : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-ink-4 border-b border-overlay/6">
                {['Tâche', 'Planning', 'Dernière exécution', 'Durée', 'Résultat', 'Prochaine'].map(x => <th key={x} className="py-2 pr-4 font-semibold">{x}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-overlay/4">
              {h.jobs.jobs.map(j => {
                const isLate = j.next && h.now - j.next > 120000;
                return (
                  <tr key={j.name}>
                    <td className="py-2 pr-4 font-mono text-ink-1">{j.name}</td>
                    <td className="py-2 pr-4 text-ink-3">{j.schedule}</td>
                    <td className="py-2 pr-4 text-ink-2 tabular-nums">{fmtTime(j.last?.at)}</td>
                    <td className="py-2 pr-4 text-ink-3 tabular-nums">{j.last ? `${j.last.durationMs} ms` : '—'}</td>
                    <td className="py-2 pr-4">{!j.last ? <span className="text-ink-4">pas encore</span> : j.last.ok ? <State ok label="OK" /> : <span title={j.last.error}><State label="Échec" /></span>}</td>
                    <td className="py-2 pr-4 tabular-nums">{isLate ? <State warn label={`en retard (${fmtTime(j.next)})`} /> : <span className="text-ink-2">{fmtTime(j.next)}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <BackupsCard b={h.backups} />

      <RestoreCard />

      <div className={card}>
        <h2 className="text-sm font-semibold text-ink-1 mb-1">Schéma des bases</h2>
        <p className="text-[11px] text-ink-3 mb-3">Version attendue : {h.schemas.latest}. {outdated.length ? `${outdated.length} base(s) pas à jour (redémarre le bot pour relancer les migrations).` : 'Toutes les bases sont à jour.'}</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
          {h.schemas.guilds.map(g => (
            <li key={g.guildId} className="flex items-center justify-between gap-2 bg-overlay/3 rounded-lg px-3 py-2">
              <span className="text-ink-2 truncate">{g.name || g.guildId}</span>
              {g.version === h.schemas.latest ? <State ok label={`v${g.version}`} /> : <State warn label={`v${g.version ?? '?'}`} />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
