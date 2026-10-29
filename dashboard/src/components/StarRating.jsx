import React from 'react';
import { Star } from 'lucide-react';

// Average rating out of 5: stars and the value (« — » without rating)
export default function StarRating({ value }) {
  if (!value) return <span className="text-ink-4">—</span>;
  const num = parseFloat(value);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map(i => (
          <Star key={i} size={11} fill={i <= Math.round(num) ? '#f59e0b' : 'none'} className={i <= Math.round(num) ? 'text-amber-400' : 'text-ink-4'} />
        ))}
      </div>
      <span className="text-xs text-ink-2 font-medium">{num.toFixed(1)}</span>
    </div>
  );
}
