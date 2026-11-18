import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { EVENT_LABELS, CHANNEL_LABELS } from './NotificationsEditor';

// Profil → Notifications (v5.2): what the space sends to me, and what I turn off
export default function NotificationPrefs() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/notifications/prefs').then(r => setData(r.data)).catch(() => setData(false)); }, []);
  if (data === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (!data || !data.rules.length) return <p className="text-xs text-ink-4">Aucune notification réglée par l'espace.</p>;
  // event → channel → imposed?
  const rows = {};
  for (const r of data.rules) for (const c of r.channels) { rows[r.event] = rows[r.event] || {}; rows[r.event][c] = rows[r.event][c] || r.imposed; }
  const toggle = async (event, channel, on) => {
    try { const r = await api.put('/notifications/prefs', { prefs: { [event]: { [channel]: on } } }); setData(d => ({ ...d, prefs: r.data.prefs })); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  return (
    <div className="space-y-1.5">
      {Object.entries(rows).map(([event, channels]) => (
        <div key={event} className="flex flex-wrap items-center gap-3 text-xs">
          <span className="w-44 text-ink-2">{EVENT_LABELS[event] || event}</span>
          {Object.entries(channels).map(([channel, imposed]) => {
            const on = imposed || data.prefs[event]?.[channel] !== false;
            return (
              <label key={channel} className="inline-flex items-center gap-1 text-ink-3" title={imposed ? 'Imposée par l\'espace' : undefined}>
                <input type="checkbox" checked={on} disabled={imposed} onChange={e => toggle(event, channel, e.target.checked)} className="accent-primary" />
                {CHANNEL_LABELS[channel]}{imposed ? ' (imposée)' : ''}
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}
