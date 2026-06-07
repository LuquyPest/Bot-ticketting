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
        className="w-full flex items-center justify-between gap-2 bg-slate-800/50 border border-slate-700/60 rounded-lg px-3 py-2 text-sm hover:border-slate-500/60 focus:outline-none transition-colors"
      >
        <span className={selected ? 'text-slate-200' : 'text-slate-500'}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          size={14}
          className={`text-slate-500 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 left-0 right-0 z-40 bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100">
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm transition-colors hover:bg-slate-800 ${
                opt.value === value
                  ? 'text-indigo-400 bg-indigo-600/5'
                  : 'text-slate-300'
              }`}
            >
              <span>{opt.label}</span>
              {opt.value === value && <Check size={13} className="text-indigo-400 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
