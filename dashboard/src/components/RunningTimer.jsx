import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Square, Timer } from 'lucide-react';
import api from '../api';
import { clock } from '../utils/duration';
import { notifyTimerChange } from './TimeTracker';

// Sidebar: my running stopwatch (ticket and time), with a stop button
export default function RunningTimer() {
  const [run, setRun] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () => api.get('/tickets/time/running').then(r => setRun(r.data ? { ...r.data, at: Date.now() } : null)).catch(() => {});
    load();
    const poll = setInterval(load, 60000);
    window.addEventListener('ticket-timer-changed', load);
    return () => { clearInterval(poll); window.removeEventListener('ticket-timer-changed', load); };
  }, []);
  useEffect(() => {
    if (!run) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run]);
  if (!run) return null;
  const stop = async () => { await api.post(`/tickets/${run.ticket_id}/time/stop`).catch(() => {}); setRun(null); notifyTimerChange(); };
  return (
    <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs" role="status">
      <Timer size={13} className="text-amber-400 shrink-0" />
      <Link to={`/tickets/${run.ticket_id}`} className="min-w-0 flex-1 truncate text-ink-1 hover:underline" title={run.subject || ''}>
        #{run.ticket_id} · <span className="tabular-nums">{clock(run.elapsed + (now - run.at) / 1000)}</span>
      </Link>
      <button onClick={stop} aria-label="Arrêter le chrono" className="text-amber-400 hover:text-amber-300"><Square size={12} /></button>
    </div>
  );
}
