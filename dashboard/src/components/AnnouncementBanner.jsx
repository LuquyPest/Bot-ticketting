import React, { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import api from '../api';
import { useAuth } from '../App';

const KEY = 'dismissedAnnouncements';
const readDismissed = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };

// Announcements of the bot administrator, for founders; each one can be dismissed (kept in this browser)
export default function AnnouncementBanner() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(readDismissed);
  useEffect(() => {
    if (user?.role !== 'fondateur') return;
    api.get('/announcements').then(r => setItems(r.data)).catch(() => {});
  }, [user?.role, user?.guildId]);
  const dismiss = (id) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  const visible = items.filter(a => !dismissed.includes(a.id));
  if (!visible.length) return null;
  return (
    <div className="space-y-2 px-6 pt-4" role="region" aria-label="Annonces">
      {visible.map(a => (
        <div key={a.id} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${a.level === 'warning' ? 'bg-amber-500/10 border-amber-500/25' : 'bg-primary/10 border-primary/25'}`}>
          <Megaphone size={15} className={`mt-0.5 shrink-0 ${a.level === 'warning' ? 'text-amber-300' : 'text-primary-light'}`} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink-1">{a.title}</p>
            <p className="text-xs text-ink-2 whitespace-pre-wrap mt-0.5">{a.body}</p>
          </div>
          <button onClick={() => dismiss(a.id)} aria-label="Masquer cette annonce" className="text-ink-4 hover:text-ink-1"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
