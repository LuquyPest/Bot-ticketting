import React from 'react';
import toast from 'react-hot-toast';

export function confirmToast(message) {
  return new Promise((resolve) => {
    toast(
      (t) => (
        <div className="flex items-center gap-2.5">
          <span className="text-sm text-ink-1 font-medium">{message}</span>
          <button
            onClick={() => { toast.dismiss(t.id); resolve(true); }}
            className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20
                       text-xs font-semibold hover:bg-red-500/20 transition-colors flex-shrink-0"
          >
            Confirmer
          </button>
          <button
            onClick={() => { toast.dismiss(t.id); resolve(false); }}
            className="px-3 py-1.5 rounded-lg bg-surface text-ink-3 border border-white/[0.08]
                       text-xs font-semibold hover:bg-surface-hover transition-colors flex-shrink-0"
          >
            Annuler
          </button>
        </div>
      ),
      {
        duration: 12000,
        style: {
          background: '#13131f',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '12px 16px',
          borderRadius: '14px',
          maxWidth: '420px',
          color: '#f1f0ff',
        },
      }
    );
  });
}
