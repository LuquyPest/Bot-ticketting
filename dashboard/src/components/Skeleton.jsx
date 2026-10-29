import React from 'react';

function SkeletonRow({ cols = 5 }) {
  const widths = ['w-8', 'w-24', 'w-32', 'w-28', 'w-16', 'w-20', 'w-24'];
  return (
    <tr className="border-b border-overlay/4">
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} className="px-4 py-4">
          <div className={`h-3.5 shimmer rounded-md bg-surface-hover ${widths[i % widths.length]}`} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard({ className = '' }) {
  return (
    <div className={`bg-surface-card border border-overlay/6 rounded-2xl p-5 space-y-3 ${className}`}>
      <div className="h-3 w-1/3 shimmer rounded-md bg-surface-hover" />
      <div className="h-8 w-1/2 shimmer rounded-lg bg-surface-hover" />
      <div className="h-3 w-2/3 shimmer rounded-md bg-surface-hover" />
    </div>
  );
}

export function SkeletonTableRows({ rows = 5, cols = 7 }) {
  return Array.from({ length: rows }, (_, i) => <SkeletonRow key={i} cols={cols} />);
}
