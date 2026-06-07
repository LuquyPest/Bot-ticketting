import React from 'react';

export default function StatCard({ label, value, icon: Icon, color = 'indigo', sub }) {
  const colors = {
    indigo:  'bg-indigo-500/10 text-indigo-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    amber:   'bg-amber-500/10  text-amber-400',
    red:     'bg-red-500/10    text-red-400',
    violet:  'bg-violet-500/10 text-violet-400'
  };

  return (
    <div className="bg-slate-900 border border-slate-800/60 rounded-xl p-4 flex items-start gap-3.5">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        <Icon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-slate-100 mt-0.5 leading-none">{value ?? '—'}</p>
        {sub && <p className="text-xs text-slate-600 mt-1">{sub}</p>}
      </div>
    </div>
  );
}
