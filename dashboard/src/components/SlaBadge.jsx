import React from 'react';
import { AlertTriangle, Timer } from 'lucide-react';

// 95 → "1 h 35", 1500 → "1 j 1 h"
export function fmtMinutes(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} j${h % 24 ? ` ${h % 24} h` : ''}`;
}

const STATE_CLS = {
  ok:       'text-ink-3',
  warning:  'text-amber-300',
  breached: 'text-red-400',
};

// Time left in the current stage's SLA (server field `sla`, utils/sla.js). Text, not color alone.
export default function SlaBadge({ sla, bar = false }) {
  if (!sla) return null;
  const limit = sla.hours * 60;
  const label = sla.state === 'breached'
    ? `Hors délai (+${fmtMinutes(sla.elapsedMinutes - limit)})`
    : `${fmtMinutes(limit - sla.elapsedMinutes)} restant${limit - sla.elapsedMinutes > 1 ? 's' : ''}`;
  const Icon = sla.state === 'breached' ? AlertTriangle : Timer;
  return (
    <span className={`inline-flex flex-col gap-1 ${bar ? 'w-full' : ''}`}
      title={`Délai de l'étape : ${sla.hours} h — dans l'étape depuis ${fmtMinutes(sla.elapsedMinutes)}`}>
      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${STATE_CLS[sla.state]}`}>
        <Icon size={10} aria-hidden="true" /> {label}
      </span>
      {bar && (
        <span className="h-1.5 w-full rounded-full bg-white/6 overflow-hidden" aria-hidden="true">
          <span className={`block h-full rounded-full ${sla.state === 'breached' ? 'bg-red-400' : sla.state === 'warning' ? 'bg-amber-400' : 'bg-(--viz-1)'}`}
            style={{ width: `${Math.min(100, (sla.elapsedMinutes / limit) * 100)}%` }} />
        </span>
      )}
    </span>
  );
}
