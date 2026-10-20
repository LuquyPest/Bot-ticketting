import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';

const card = 'glass-dark rounded-2xl border border-overlay/8 p-5';
const fmtDur = s => (s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 86400)} j ${Math.floor((s % 86400) / 3600)} h`);
const fmtTime = t => (t ? new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

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
  useEffect(() => { api.get('/sa/demo').then(r => setDemo(r.data)).catch(() => {}); }, []);
  if (!demo) return null;
  const toggle = async () => { try { const r = await api.put('/sa/demo', { enabled: !demo.enabled }); setDemo(r.data); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const reset = async () => {
    setBusy(true);
    try { const r = await api.post('/sa/demo/reset'); toast.success(`Démo réinitialisée (${r.data.tickets} tickets)`); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <div className="glass-dark rounded-2xl border border-overlay/8 px-5 py-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-1">Serveur de démonstration {demo.enabled ? <span className="text-emerald-400 text-xs">· activé</span> : <span className="text-ink-4 text-xs">· désactivé</span>}</p>
        <p className="text-[11px] text-ink-4">Bouton « Essayer la démo » sur la connexion et pour les serveurs en attente ; données fictives remises à zéro chaque nuit (4 h 15).</p>
      </div>
      <button onClick={toggle} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1">{demo.enabled ? 'Désactiver' : 'Activer'}</button>
      <button onClick={reset} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">{busy ? 'Réinitialisation…' : 'Réinitialiser maintenant'}</button>
    </div>
  );
}

export default function SAHealth() {
  const [h, setH] = useState(null);
  const load = useCallback(() => {
    api.get('/sa/health').then(r => setH(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
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
          <p className="text-sm text-ink-3">État du bot et de ses dépendances — actualisé toutes les 15 s</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/5" title="Actualiser"><RefreshCw size={15} /></button>
      </div>

      <DemoCard />

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

      <div className={`${card} overflow-x-auto`}>
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
