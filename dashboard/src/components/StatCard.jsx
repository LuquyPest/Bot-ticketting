import React from 'react';

const COLOR_MAP = {
  indigo:  { icon: 'bg-primary/12 text-primary-light',    glow: 'rgba(124,110,243,0.18)', bar: '#7c6ef3', ring: 'rgba(124,110,243,0.25)' },
  emerald: { icon: 'bg-emerald-500/12 text-emerald-400',  glow: 'rgba(16,185,129,0.14)',  bar: '#10b981', ring: 'rgba(16,185,129,0.2)' },
  amber:   { icon: 'bg-amber-500/12 text-amber-400',      glow: 'rgba(245,158,11,0.14)',  bar: '#f59e0b', ring: 'rgba(245,158,11,0.2)' },
  red:     { icon: 'bg-red-500/12 text-red-400',          glow: 'rgba(239,68,68,0.14)',   bar: '#ef4444', ring: 'rgba(239,68,68,0.2)' },
  violet:  { icon: 'bg-violet-500/12 text-violet-400',    glow: 'rgba(139,92,246,0.16)',  bar: '#8b5cf6', ring: 'rgba(139,92,246,0.22)' },
  sky:     { icon: 'bg-sky-500/12 text-sky-400',          glow: 'rgba(14,165,233,0.14)',  bar: '#0ea5e9', ring: 'rgba(14,165,233,0.2)' },
  teal:    { icon: 'bg-teal-500/12 text-teal-400',        glow: 'rgba(20,184,166,0.14)',  bar: '#14b8a6', ring: 'rgba(20,184,166,0.2)' },
};

export default function StatCard({ label, value, icon: Icon, color = 'indigo', sub, trend }) {
  const c = COLOR_MAP[color] || COLOR_MAP.indigo;

  return (
    <div
      className="relative bg-surface-card rounded-2xl p-5 overflow-hidden
                 transition-all duration-200 group cursor-default"
      style={{
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: `0 1px 3px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.05), 0 6px 28px ${c.glow}`,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)';
        e.currentTarget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.09), 0 10px 40px ${c.glow}`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
        e.currentTarget.style.boxShadow = `0 1px 3px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.05), 0 6px 28px ${c.glow}`;
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px] opacity-60 group-hover:opacity-90 transition-opacity"
        style={{ background: `linear-gradient(90deg, transparent 0%, ${c.bar} 35%, ${c.bar} 65%, transparent 100%)` }}
      />

      <div className="flex items-start justify-between gap-3">
        {/* Text block */}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-[0.1em] leading-none mb-2.5">
            {label}
          </p>
          <div className="flex items-baseline gap-2.5">
            <p className="text-[2rem] font-bold text-ink-1 leading-none tabular-nums tracking-tight">
              {value ?? '—'}
            </p>
            {trend !== undefined && (
              <span className={`text-xs font-semibold ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {trend >= 0 ? '+' : ''}{trend}%
              </span>
            )}
          </div>
          {sub && (
            <p className="text-xs text-ink-4 mt-1.5 leading-tight">{sub}</p>
          )}
        </div>

        {/* Icon */}
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5
                      transition-transform duration-200 group-hover:scale-110 ${c.icon}`}
          style={{ boxShadow: `0 0 16px ${c.ring}` }}
        >
          <Icon size={18} />
        </div>
      </div>

      {/* Bottom glow fade */}
      <div
        className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none opacity-20 group-hover:opacity-30 transition-opacity"
        style={{ background: `radial-gradient(ellipse at 50% 100%, ${c.bar} 0%, transparent 70%)` }}
      />
    </div>
  );
}
