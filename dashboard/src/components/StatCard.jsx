import React from 'react';

const COLOR_MAP = {
  indigo:  {
    icon:  'bg-primary/10 text-primary-light',
    glow:  'rgba(124,110,243,0.2)',
    bar:   'from-primary to-indigo-400',
  },
  emerald: {
    icon:  'bg-emerald-500/10 text-emerald-400',
    glow:  'rgba(16,185,129,0.15)',
    bar:   'from-emerald-500 to-teal-400',
  },
  amber:   {
    icon:  'bg-amber-500/10 text-amber-400',
    glow:  'rgba(245,158,11,0.15)',
    bar:   'from-amber-500 to-yellow-400',
  },
  red:     {
    icon:  'bg-red-500/10 text-red-400',
    glow:  'rgba(239,68,68,0.15)',
    bar:   'from-red-500 to-rose-400',
  },
  violet:  {
    icon:  'bg-violet-500/10 text-violet-400',
    glow:  'rgba(139,92,246,0.18)',
    bar:   'from-violet-500 to-purple-400',
  },
  sky:     {
    icon:  'bg-sky-500/10 text-sky-400',
    glow:  'rgba(14,165,233,0.15)',
    bar:   'from-sky-500 to-cyan-400',
  },
  teal:    {
    icon:  'bg-teal-500/10 text-teal-400',
    glow:  'rgba(20,184,166,0.15)',
    bar:   'from-teal-500 to-emerald-400',
  },
};

export default function StatCard({ label, value, icon: Icon, color = 'indigo', sub, trend }) {
  const c = COLOR_MAP[color] || COLOR_MAP.indigo;

  return (
    <div
      className="relative bg-surface-card border border-white/[0.06] rounded-2xl p-4 overflow-hidden
                 transition-all duration-200 hover:border-white/[0.1] hover:shadow-card-hover group"
      style={{ boxShadow: `0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05), 0 8px 32px ${c.glow}` }}
    >
      {/* Top gradient line */}
      <div className={`absolute top-0 left-4 right-4 h-px bg-gradient-to-r ${c.bar} opacity-40
                       group-hover:opacity-60 transition-opacity`} />

      <div className="flex items-start gap-3.5">
        {/* Icon */}
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${c.icon}
                         transition-transform duration-200 group-hover:scale-105`}>
          <Icon size={16} />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider leading-tight">
            {label}
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-2xl font-bold text-ink-1 leading-none tabular-nums">
              {value ?? '—'}
            </p>
            {trend !== undefined && (
              <span className={`text-xs font-medium ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {trend >= 0 ? '+' : ''}{trend}%
              </span>
            )}
          </div>
          {sub && (
            <p className="text-xs text-ink-3 mt-1 leading-tight">{sub}</p>
          )}
        </div>
      </div>
    </div>
  );
}
