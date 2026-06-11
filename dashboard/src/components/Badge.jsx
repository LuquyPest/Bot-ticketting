import React from 'react';

const VARIANTS = {
  open: {
    cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    dot: 'bg-emerald-400',
    pulse: true,
    label: 'Ouvert',
  },
  closed: {
    cls: 'bg-white/[0.05] text-ink-3 border-white/[0.08]',
    dot: 'bg-ink-4',
    pulse: false,
    label: 'Fermé',
  },
  low: {
    cls: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    dot: 'bg-sky-400',
    pulse: false,
    label: 'Faible',
  },
  normal: {
    cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    dot: 'bg-amber-400',
    pulse: false,
    label: 'Normal',
  },
  urgent: {
    cls: 'bg-red-500/10 text-red-400 border-red-500/20',
    dot: 'bg-red-400',
    pulse: false,
    label: 'Urgent',
  },
  default: {
    cls: 'bg-white/[0.05] text-ink-2 border-white/[0.08]',
    dot: 'bg-ink-3',
    pulse: false,
    label: null,
  },
};

export default function Badge({ label, variant }) {
  const v = VARIANTS[variant] || VARIANTS.default;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full
                  text-[11px] font-semibold border ${v.cls}`}
      role="status"
      aria-label={label || v.label || variant}
    >
      <span className="relative flex-shrink-0 w-1.5 h-1.5">
        <span className={`block w-1.5 h-1.5 rounded-full ${v.dot}`} />
        {v.pulse && (
          <span
            className={`absolute inset-0 rounded-full ${v.dot} opacity-0 dot-pulse`}
            aria-hidden="true"
          />
        )}
      </span>
      {label || v.label || variant}
    </span>
  );
}
