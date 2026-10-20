import React from 'react';

// Labels of a member profile (« VIP », « à surveiller »…)
export default function LabelChips({ labels, size = 'text-[10px]' }) {
  if (!labels?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {labels.map(l => <span key={l} className={`${size} font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/25`}>{l}</span>)}
    </span>
  );
}

