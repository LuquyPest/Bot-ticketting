import React from 'react';

const variants = {
  open:    { pill: 'bg-emerald-600/15 text-emerald-400 border-emerald-600/25', dot: 'bg-emerald-400' },
  closed:  { pill: 'bg-slate-600/20  text-slate-400  border-slate-600/30',  dot: 'bg-slate-400' },
  low:     { pill: 'bg-sky-600/15    text-sky-400    border-sky-600/25',    dot: 'bg-sky-400' },
  normal:  { pill: 'bg-amber-600/15  text-amber-400  border-amber-600/25',  dot: 'bg-amber-400' },
  urgent:  { pill: 'bg-red-600/15    text-red-400    border-red-600/25',    dot: 'bg-red-400' },
  default: { pill: 'bg-slate-700/40  text-slate-400  border-slate-700/60',  dot: 'bg-slate-500' }
};

export default function Badge({ label, variant }) {
  const { pill, dot } = variants[variant] || variants.default;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {label}
    </span>
  );
}
