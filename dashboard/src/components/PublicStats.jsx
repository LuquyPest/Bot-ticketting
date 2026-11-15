import React, { useEffect, useState } from 'react';
import { ExternalLink, Send, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const fmt = m => (m == null ? '—' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${Math.floor(m / 1440)} j ${Math.floor((m % 1440) / 60)} h`);

// Figures of the public statistics message (Paramètres → Salons), and « Publier maintenant »
export default function PublicStats({ channelId, savedChannelId, dirty }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/config/public-stats').then(r => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, [savedChannelId]);
  const publish = async () => {
    setBusy(true);
    try { const r = await api.post('/config/public-stats/publish'); toast.success('Statistiques publiées'); setData(d => ({ ...d, stats: r.data.stats, messageUrl: r.data.url })); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const s = data?.stats;
  const items = s ? [
    ['Tickets résolus', s.resolved],
    ['Première réponse (médiane)', fmt(s.firstResponseMedianMin)],
    [`Réponse en moins de ${s.targetHours} h`, s.withinTargetPct == null ? '—' : `${s.withinTargetPct} %`],
    ['Résolution (médiane)', fmt(s.resolutionMedianMin)],
    ['Satisfaction', s.satisfaction ? `${s.satisfaction.average} / 5 (${s.satisfaction.count})` : '—'],
  ] : [];
  return (
    <div className="space-y-3">
      {s && (
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {items.map(([k, v]) => (
            <div key={k} className="bg-surface border border-overlay/6 rounded-lg px-3 py-2">
              <dt className="text-[11px] text-ink-4">{k}</dt>
              <dd className="text-sm font-semibold text-ink-1 tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={publish} disabled={busy || !savedChannelId || dirty}
          title={dirty || channelId !== savedChannelId ? 'Sauvegarde d\'abord les paramètres' : undefined}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-primary text-white hover:bg-primary-light disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}Publier maintenant
        </button>
        {data?.messageUrl && <a href={data.messageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-light hover:underline inline-flex items-center gap-1">Voir le message sur Discord <ExternalLink size={11} aria-hidden="true" /></a>}
        {!savedChannelId && <span className="text-xs text-ink-4">Choisis un salon puis sauvegarde : le message est ensuite mis à jour toutes les heures.</span>}
      </div>
    </div>
  );
}
