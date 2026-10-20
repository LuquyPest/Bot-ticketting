import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Wrench, Activity, Loader2 } from 'lucide-react';
import api from '../api';

// Public status page: is the bot / dashboard working, current incidents, 90-day history
const LEVEL = {
  operational: { label: 'Opérationnel', icon: CheckCircle2, text: 'text-emerald-400', bar: 'bg-emerald-500' },
  maintenance: { label: 'Maintenance', icon: Wrench, text: 'text-sky-400', bar: 'bg-sky-500' },
  degraded:    { label: 'Perturbé', icon: AlertTriangle, text: 'text-amber-400', bar: 'bg-amber-500' },
  down:        { label: 'Interrompu', icon: XCircle, text: 'text-red-400', bar: 'bg-red-500' },
};
const COMPONENTS = { bot: 'Bot Discord (réception et envoi des messages)', dashboard: 'Dashboard et espace membre', database: 'Base de données' };
const OVERALL = { operational: 'Tous les services fonctionnent', maintenance: 'Maintenance en cours', degraded: 'Service perturbé', down: 'Interruption de service' };
const fmt = d => new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const KIND = { incident: 'Incident', maintenance: 'Maintenance' };

function Level({ level }) {
  const l = LEVEL[level] || LEVEL.operational;
  const Icon = l.icon;
  return <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${l.text}`}><Icon size={13} /> {l.label}</span>;
}

export default function Status() {
  const [data, setData] = useState(null);
  useEffect(() => {
    document.title = 'Statut du service';
    const load = () => api.get('/status').then(r => setData(r.data)).catch(() => setData({ overall: 'down', components: {}, current: [], history: [], days: [] }));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <div className="min-h-screen bg-base flex items-center justify-center"><Loader2 className="animate-spin text-ink-4" /></div>;
  const o = LEVEL[data.overall] || LEVEL.down;
  const OIcon = o.icon;
  return (
    <div className="min-h-screen bg-base">
      <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <header className="flex items-center gap-2 text-ink-1"><Activity size={18} className="text-primary-light" /><h1 className="text-lg font-bold">Statut du service</h1></header>

        <section className="rounded-2xl border border-overlay/6 bg-surface-card p-5 flex items-center gap-3" role="status">
          <OIcon size={28} className={o.text} />
          <div>
            <p className="text-base font-semibold text-ink-1">{OVERALL[data.overall] || OVERALL.down}</p>
            {data.checkedAt && <p className="text-[11px] text-ink-4">Vérifié le {fmt(data.checkedAt)} · actualisé chaque minute</p>}
          </div>
        </section>

        {data.current?.length > 0 && (
          <section className="space-y-2" aria-labelledby="current-title">
            <h2 id="current-title" className="text-sm font-semibold text-ink-2">En cours</h2>
            {data.current.map(e => (
              <article key={e.id} className={`rounded-2xl border p-4 ${e.kind === 'maintenance' ? 'border-sky-500/30 bg-sky-500/5' : e.severity === 'major' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                <p className="text-sm font-semibold text-ink-1">{KIND[e.kind]} · {e.title}</p>
                {e.message && <p className="text-xs text-ink-2 mt-1 whitespace-pre-wrap">{e.message}</p>}
                <p className="text-[11px] text-ink-4 mt-1.5">Depuis le {fmt(e.started_at)}</p>
              </article>
            ))}
          </section>
        )}

        <section className="rounded-2xl border border-overlay/6 bg-surface-card divide-y divide-overlay/5" aria-label="Services">
          {Object.entries(COMPONENTS).map(([k, label]) => (
            <div key={k} className="flex items-center gap-3 px-5 py-3">
              <span className="text-sm text-ink-1 flex-1">{label}</span>
              <Level level={data.components?.[k] || 'down'} />
            </div>
          ))}
        </section>

        {data.days?.length > 0 && (
          <section className="rounded-2xl border border-overlay/6 bg-surface-card p-5 space-y-3" aria-labelledby="history-title">
            <div className="flex items-baseline gap-2">
              <h2 id="history-title" className="text-sm font-semibold text-ink-2 flex-1">90 derniers jours</h2>
              {data.uptime != null && <span className="text-xs text-ink-2">Disponibilité du bot : <strong className="text-ink-1">{data.uptime} %</strong></span>}
            </div>
            <div className="flex gap-[2px] h-8" role="img" aria-label={`Historique de 90 jours : ${data.days.filter(d => d.level !== 'operational').length} jour(s) avec un événement`}>
              {data.days.map(d => (
                <span key={d.date} title={`${new Date(d.date).toLocaleDateString('fr-FR')} : ${LEVEL[d.level].label}`}
                  className={`flex-1 rounded-sm ${LEVEL[d.level].bar} ${d.level === 'operational' ? 'opacity-70' : ''}`} />
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-ink-3">
              {Object.entries(LEVEL).map(([k, l]) => <span key={k} className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-sm ${l.bar}`} />{l.label}</span>)}
            </div>
          </section>
        )}

        <section className="space-y-2" aria-labelledby="past-title">
          <h2 id="past-title" className="text-sm font-semibold text-ink-2">Historique des incidents</h2>
          {!data.history?.length ? <p className="text-sm text-ink-4">Aucun incident ces 90 derniers jours.</p> : (
            <ul className="space-y-2">
              {data.history.map(e => (
                <li key={e.id} className="rounded-xl border border-overlay/6 bg-surface-card px-4 py-3">
                  <p className="text-sm text-ink-1"><span className="text-ink-3">{KIND[e.kind]} ·</span> {e.title}</p>
                  {e.message && <p className="text-xs text-ink-2 mt-0.5 whitespace-pre-wrap">{e.message}</p>}
                  <p className="text-[11px] text-ink-4 mt-1">{fmt(e.started_at)} → {fmt(e.resolved_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
