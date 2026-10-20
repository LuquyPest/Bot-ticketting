import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import api from '../api';
import { TAG, VERSIONS, LATEST_VERSION, compareVersions } from '../data/patchnotes';

// « Nouveautés » card for founders: changes released since their last visit (versions newer than
// the last one they marked as seen). On a first visit only the latest version is shown.
export function useWhatsNew(enabled) {
  const [seen, setSeen] = useState(undefined);
  useEffect(() => {
    if (!enabled) return;
    api.get('/profile/whats-new').then(r => setSeen(r.data.seen)).catch(() => setSeen(LATEST_VERSION));
  }, [enabled]);
  const unseen = seen === undefined ? [] : seen ? VERSIONS.filter(v => compareVersions(v.version, seen) > 0) : VERSIONS.slice(0, 1);
  const markSeen = async () => {
    setSeen(LATEST_VERSION);
    await api.put('/profile/whats-new', { version: LATEST_VERSION }).catch(() => {});
  };
  return { unseen, markSeen };
}

export default function WhatsNew({ unseen, markSeen }) {
  const [open, setOpen] = useState(false);
  if (!unseen.length) return null;
  const changes = unseen.flatMap(v => v.changes.map(c => ({ ...c, version: v.version })));
  const shown = open ? changes : changes.slice(0, 4);
  return (
    <section className="mx-4 sm:mx-6 mt-4 rounded-2xl border border-primary/25 bg-primary/5 p-4" aria-labelledby="whats-new-title">
      <div className="flex items-start gap-3">
        <Sparkles size={16} className="text-primary-light mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id="whats-new-title" className="text-sm font-semibold text-ink-1">
            Nouveautés depuis ta dernière visite <span className="text-ink-3 font-normal">· {unseen.map(v => v.version).join(', ')}</span>
          </h2>
          <ul className="mt-2 space-y-1.5">
            {shown.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-ink-2">
                <span className={`shrink-0 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${TAG[c.type]?.cls || ''}`}>{TAG[c.type]?.label || c.type}</span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            {changes.length > 4 && (
              <button onClick={() => setOpen(o => !o)} className="text-primary-light hover:underline">
                {open ? 'Voir moins' : `Voir les ${changes.length - 4} autres`}
              </button>
            )}
            <Link to="/patchnotes" className="text-ink-3 hover:text-ink-1 underline">Tout le Patchnotes</Link>
            <button onClick={markSeen} className="ml-auto px-3 py-1.5 rounded-lg bg-primary text-white font-semibold">J'ai vu</button>
          </div>
        </div>
        <button onClick={markSeen} aria-label="Fermer les nouveautés" className="p-1 rounded-lg text-ink-4 hover:text-ink-1"><X size={14} /></button>
      </div>
    </section>
  );
}
