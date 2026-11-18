import React from 'react';
import { Timer } from 'lucide-react';
import { uiLocale } from '../i18n';
import { fmtMinutes } from './SlaBadge';

// Fiche ticket → Objectifs SLA (v5.1): time to first response and to resolution
const STATE = {
  ok: ['Dans les temps', 'text-emerald-300'], warning: ['Bientôt dépassé', 'text-amber-300'], breached: ['Dépassé', 'text-red-300'],
  met: ['Tenu', 'text-emerald-300'], missed: ['Manqué', 'text-red-300'], paused: ['En pause (en attente du demandeur)', 'text-ink-3'],
};
function Line({ label, o }) {
  if (!o) return null;
  const [text, cls] = STATE[o.state] || ['—', 'text-ink-3'];
  const extra = o.state === 'breached' ? ` (+${fmtMinutes(o.minutesLate)})` : ['ok', 'warning'].includes(o.state) ? ` · ${fmtMinutes(o.minutesLeft)} restant(s)` : '';
  return (
    <div className="text-xs">
      <p className="flex justify-between gap-2"><span className="text-ink-3">{label}</span><span className={`font-semibold ${cls}`}>{text}{extra}</span></p>
      <p className="text-[11px] text-ink-4">{`Échéance : ${new Date(o.dueAt).toLocaleString(uiLocale(), { dateStyle: 'short', timeStyle: 'short' })}`}</p>
    </div>
  );
}
export default function ObjectivesPanel({ objectives, panelCard }) {
  if (!objectives || (!objectives.tto && !objectives.ttr)) return null;
  return (
    <div className={panelCard}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-2 inline-flex items-center gap-1.5"><Timer size={12} aria-hidden="true" />Objectifs SLA</p>
      <div className="space-y-2">
        <Line label="Prise en charge" o={objectives.tto} />
        <Line label="Résolution" o={objectives.ttr} />
      </div>
    </div>
  );
}
