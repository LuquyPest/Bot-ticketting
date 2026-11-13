import React, { useEffect, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { SKINS, SKIN_LABELS, readSkin, applySkin } from '../ui/skin';

// Interface preferences of the account (every browser): skin (classic / pro) and split view of
// the Tickets page
export default function InterfacePrefs() {
  const [skin, setSkin] = useState(readSkin);
  const [splitView, setSplitView] = useState(null);
  useEffect(() => { api.get('/profile/prefs').then(r => setSplitView(!!r.data.splitView)).catch(() => setSplitView(false)); }, []);

  const chooseSkin = async (next) => {
    if (next === skin) return;
    const previous = skin;
    setSkin(next);
    applySkin(next);
    try { await api.put('/profile/prefs', { uiSkin: next }); }
    catch (err) { setSkin(previous); applySkin(previous); toast.error(err.response?.data?.error || 'Erreur'); }
  };

  const toggle = async () => {
    const next = !splitView;
    setSplitView(next);
    try { await api.put('/profile/prefs', { splitView: next }); }
    catch (err) { setSplitView(!next); toast.error(err.response?.data?.error || 'Erreur'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink-1">Interface</span>
        <div role="radiogroup" aria-label="Interface" className="inline-flex rounded-lg border border-overlay/8 overflow-hidden">
          {SKINS.map(s => (
            <button key={s} type="button" role="radio" aria-checked={skin === s} onClick={() => chooseSkin(s)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${skin === s ? 'bg-primary text-white' : 'text-ink-3 hover:text-ink-1 hover:bg-overlay/6'}`}>
              {SKIN_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={!!splitView} disabled={splitView === null} onChange={toggle} className="mt-0.5" />
        <span className="text-sm font-medium text-ink-1">Vue fractionnée des tickets</span>
      </label>
    </div>
  );
}
