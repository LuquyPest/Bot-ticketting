import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export default function Select({ value, onChange, options, placeholder = 'Sélectionner...', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2
                   bg-surface border border-white/[0.07] rounded-xl px-3.5 py-2 text-sm
                   hover:border-white/[0.12] focus:outline-none focus:border-primary/50
                   transition-all duration-150"
      >
        <span className={selected ? 'text-ink-1' : 'text-ink-3'}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          size={13}
          className={`text-ink-3 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 left-0 right-0 z-40
                        bg-surface-elevated border border-white/[0.08] rounded-xl
                        shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden animate-in">
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm
                          transition-colors hover:bg-white/[0.05]
                          ${opt.value === value ? 'text-primary-light bg-primary/5' : 'text-ink-2'}`}
            >
              <span>{opt.label}</span>
              {opt.value === value && <Check size={12} className="text-primary-light flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
