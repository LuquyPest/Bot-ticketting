import React from 'react';

export default function StatCard({ label, value, icon: Icon, color = 'indigo', sub }) {
  const colors = {
    indigo: 'bg-indigo-600/15 text-indigo-400',
    emerald: 'bg-emerald-600/15 text-emerald-400',
    amber: 'bg-amber-600/15 text-amber-400',
    red: 'bg-red-600/15 text-red-400',
    violet: 'bg-violet-600/15 text-violet-400'
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-slate-100 mt-0.5">{value ?? '—'}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
