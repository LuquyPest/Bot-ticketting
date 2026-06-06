import React from 'react';

const variants = {
  open:    'bg-emerald-600/20 text-emerald-400 border-emerald-600/30',
  closed:  'bg-slate-600/20  text-slate-400  border-slate-600/30',
  low:     'bg-sky-600/20    text-sky-400    border-sky-600/30',
  normal:  'bg-amber-600/20  text-amber-400  border-amber-600/30',
  urgent:  'bg-red-600/20    text-red-400    border-red-600/30',
  default: 'bg-slate-700/40  text-slate-400  border-slate-700/60'
};

export default function Badge({ label, variant }) {
  const cls = variants[variant] || variants.default;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}
