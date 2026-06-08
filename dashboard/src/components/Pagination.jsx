import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, pages, onChange }) {
  if (pages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="p-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-white/[0.06]
                   disabled:opacity-25 disabled:cursor-not-allowed transition-all duration-150"
      >
        <ChevronLeft size={16} />
      </button>

      <span className="text-sm text-ink-2 px-1">
        Page <span className="text-ink-1 font-semibold tabular-nums">{page}</span>
        <span className="text-ink-4 mx-1">/</span>
        <span className="tabular-nums">{pages}</span>
      </span>

      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= pages}
        className="p-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-white/[0.06]
                   disabled:opacity-25 disabled:cursor-not-allowed transition-all duration-150"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
