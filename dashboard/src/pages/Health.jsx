import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Loader2, FolderTree, Hash, Shield, KeyRound } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';

function Status({ ok, label }) {
  return ok
    ? <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 size={13} aria-hidden="true" /> {label || 'OK'}</span>
    : <span className="inline-flex items-center gap-1 text-xs text-red-400"><XCircle size={13} aria-hidden="true" /> {label || 'Problème'}</span>;
}

function Card({ icon: Icon, title, children, empty }) {
  return (
    <section className="bg-surface-card border border-overlay/6 rounded-2xl p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-2 mb-3"><Icon size={14} aria-hidden="true" /> {title}</h2>
      {empty ? <p className="text-xs text-ink-4">{empty}</p> : <ul className="divide-y divide-overlay/6">{children}</ul>}
    </section>
  );
}

// Bot setup of the server: what is missing or broken, before it makes a ticket action fail
export default function Health() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/server-health').then(r => setReport(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleAlerts = async () => {
    try {
      const { data } = await api.put('/server-health/alerts', { enabled: !report.alertsEnabled });
      setReport(r => ({ ...r, alertsEnabled: data.alertsEnabled }));
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  if (!report) {
    return <div className="p-6 flex items-center gap-2 text-sm text-ink-3"><Loader2 size={14} className="animate-spin" /> Vérification du serveur…</div>;
  }
  const problems = report.problems || [];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-ink-1">Santé du serveur</h1>
          <p className="text-sm text-ink-3 mt-0.5">Permissions du bot, salons, catégories et rôles configurés. Vérifié toutes les 15 minutes et après chaque changement sur Discord : un nouveau problème t'est envoyé en MP.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-overlay/8 text-sm text-ink-2 hover:text-ink-1 disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Revérifier
        </button>
      </div>

      <div role="status" className={`rounded-2xl border p-4 ${problems.length ? 'border-amber-500/30 bg-amber-500/8' : 'border-emerald-500/30 bg-emerald-500/8'}`}>
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-1">
          {problems.length ? <AlertTriangle size={16} className="text-amber-400" aria-hidden="true" /> : <CheckCircle2 size={16} className="text-emerald-400" aria-hidden="true" />}
          {problems.length ? `${problems.length} problème${problems.length > 1 ? 's' : ''} à corriger` : 'Tout fonctionne'}
        </p>
        {problems.length > 0 && <ul className="mt-2 space-y-1 text-sm text-ink-2 list-disc pl-6">{problems.map(p => <li key={p.id}>{p.text}</li>)}</ul>}
        {problems.some(p => p.id.startsWith('perm:')) && (
          <p className="mt-2 text-xs text-ink-3">Pour une permission manquante : Paramètres du serveur Discord → Rôles → rôle du bot, ou réinvite le bot avec le lien de la page de sélection du serveur.</p>
        )}
        <p className="mt-2 text-[11px] text-ink-4">Vérifié le {new Date(report.checkedAt).toLocaleString(uiLocale())} · tickets en {report.mode === 'thread' ? 'fils privés' : 'salons'}</p>
      </div>

      <Card icon={KeyRound} title="Permissions du bot sur le serveur">
        {report.permissions.map(p => (
          <li key={p.key} className="flex items-center gap-3 py-2">
            <div className="flex-1 min-w-0"><p className="text-sm text-ink-1">{p.label}</p><p className="text-xs text-ink-4">{p.why}</p></div>
            <Status ok={p.ok} label={p.ok ? 'Accordée' : 'Manquante'} />
          </li>
        ))}
      </Card>

      <Card icon={FolderTree} title="Catégories de tickets" empty={!report.categories.length && 'Aucune catégorie configurée.'}>
        {report.categories.map(c => {
          const full = c.count >= c.limit;
          return (
            <li key={c.id} className="py-2">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0"><p className="text-sm text-ink-1">{c.label}</p><p className="text-xs text-ink-4 truncate">{c.name}</p></div>
                <span className={`text-xs tabular-nums ${full ? 'text-amber-400' : 'text-ink-3'}`}>{c.count} / {c.limit} salons</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-overlay/6 overflow-hidden" aria-hidden="true">
                <div className={`h-full rounded-full ${full ? 'bg-amber-400' : 'bg-primary'}`} style={{ width: `${Math.min(100, (c.count / c.limit) * 100)}%` }} />
              </div>
              {c.overflow.length > 0 && (
                <p className="mt-1 text-xs text-ink-3">Débordement : {c.overflow.map(o => `${o.name} (${o.count})`).join(', ')}</p>
              )}
            </li>
          );
        })}
      </Card>

      <Card icon={Hash} title="Salons configurés" empty={!report.channels.length && 'Aucun salon configuré.'}>
        {report.channels.map(c => (
          <li key={c.field} className="flex items-center gap-3 py-2">
            <div className="flex-1 min-w-0"><p className="text-sm text-ink-1">{c.label}</p><p className="text-xs text-ink-4 truncate">{c.name ? `#${c.name}` : c.id}</p></div>
            <Status ok={c.ok} label={c.ok ? 'OK' : c.problem} />
          </li>
        ))}
      </Card>

      <Card icon={Shield} title="Rôles du staff" empty={!report.roles.length && 'Aucun rôle support configuré.'}>
        {report.roles.map(r => (
          <li key={`${r.field}-${r.id}`} className="flex items-center gap-3 py-2">
            <div className="flex-1 min-w-0"><p className="text-sm text-ink-1">{r.label}</p><p className="text-xs text-ink-4 truncate">{r.name ? `@${r.name}` : r.id}</p></div>
            <Status ok={r.ok} label={r.ok ? 'OK' : r.problem} />
          </li>
        ))}
      </Card>

      {report.channelCount && (
        <p className="text-xs text-ink-3">Salons sur le serveur : {report.channelCount.used} / {report.channelCount.limit}.{report.mode !== 'thread' && report.channelCount.used > 400 && <> Pense au format <Link to="/settings" className="underline">fils privés</Link> (Paramètres) pour ne plus dépendre de cette limite.</>}</p>
      )}

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={!!report.alertsEnabled} onChange={toggleAlerts} />
        M'envoyer un MP quand un nouveau problème apparaît (à tous les fondateurs)
      </label>
    </div>
  );
}
