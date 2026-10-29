import React, { useEffect, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

// Interface preferences of the account (every browser): split view of the Tickets page
export default function InterfacePrefs() {
  const [splitView, setSplitView] = useState(null);
  useEffect(() => { api.get('/profile/prefs').then(r => setSplitView(!!r.data.splitView)).catch(() => setSplitView(false)); }, []);

  const toggle = async () => {
    const next = !splitView;
    setSplitView(next);
    try { await api.put('/profile/prefs', { splitView: next }); }
    catch (err) { setSplitView(!next); toast.error(err.response?.data?.error || 'Erreur'); }
  };

  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={!!splitView} disabled={splitView === null} onChange={toggle} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium text-ink-1">Vue fractionnée des tickets</span>
        <span className="block text-xs text-ink-3 mt-0.5">Sur grand écran, un ticket cliqué dans la liste s'ouvre à droite de celle-ci, sans changer de page.</span>
      </span>
    </label>
  );
}
