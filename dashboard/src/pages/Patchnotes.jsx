import React, { useEffect, useState } from 'react';
import { ScrollText, ChevronDown, ChevronUp } from 'lucide-react';

import { TAG, VERSIONS } from '../data/patchnotes';
import { useAuth } from '../App';

function VersionCard({ v }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="bg-surface-card border border-overlay/6 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-surface/40 transition-colors text-left"
      >
        <span className="px-2.5 py-1 rounded-lg bg-indigo-600/20 border border-primary/30 text-primary-light text-xs font-bold font-mono shrink-0">
          {v.version}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-1">{v.title}</p>
          <p className="text-xs text-ink-3 mt-0.5">{v.date}</p>
        </div>
        <span className="text-xs text-ink-4 shrink-0">{v.changes.length} changement(s)</span>
        {open ? <ChevronUp size={15} className="text-ink-4 shrink-0" /> : <ChevronDown size={15} className="text-ink-4 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-overlay/6 px-5 py-4 space-y-2">
          {v.changes.map((c, i) => {
            const tag = TAG[c.type];
            return (
              <div key={i} className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 px-1.5 py-0.5 rounded-sm text-xs font-medium border ${tag.cls}`}>
                  {tag.label}
                </span>
                <p className="text-sm text-ink-2 leading-relaxed">{c.text}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Patchnotes() {
  // Reading the patch notes counts as having seen the news
  const { whatsNew } = useAuth();
  useEffect(() => { if (whatsNew?.unseen?.length) whatsNew.markSeen(); }, [whatsNew?.unseen?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary-light flex items-center justify-center shrink-0">
          <ScrollText size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-1">Patchnotes</h1>
          <p className="text-sm text-ink-3 mt-0.5">Historique de toutes les modifications depuis le lancement</p>
        </div>
      </div>

      <div className="space-y-3">
        {VERSIONS.map(v => <VersionCard key={v.version} v={v} />)}
      </div>
    </div>
  );
}
