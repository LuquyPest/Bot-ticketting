import React, { useCallback, useEffect, useState } from 'react';
import { Play, Square, Plus, Trash2, Timer } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { fmtSeconds, clock } from '../utils/duration';
import { fmtDate } from '../utils/format';

// Tells the sidebar stopwatch to refresh
export const notifyTimerChange = () => window.dispatchEvent(new Event('ticket-timer-changed'));

// « Temps passé » panel of the ticket view: my stopwatch, time added by hand, totals per member
export default function TimeTracker({ ticketId, canTrack, open, userId, isFounder, SectionTitle, panelCard }) {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [showEntries, setShowEntries] = useState(false);

  // loadedAt: when the server counted the running stopwatch (the display adds the time since)
  const put = d => setData({ ...d, loadedAt: Date.now() });
  const load = useCallback(() => api.get(`/tickets/${ticketId}/time`).then(r => put(r.data)).catch(() => {}), [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data?.running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [data?.running]);
  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('ticket-timer-changed', onChange);
    return () => window.removeEventListener('ticket-timer-changed', onChange);
  }, [load]);

  const act = async (action) => {
    try { const r = await api.post(`/tickets/${ticketId}/time/${action}`); put(r.data); setNow(Date.now()); notifyTimerChange(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const add = async (e) => {
    e.preventDefault();
    try { const r = await api.post(`/tickets/${ticketId}/time`, { minutes: parseInt(minutes), note }); put(r.data); setMinutes(''); setNote(''); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const remove = async (entry) => {
    try { await api.delete(`/tickets/time/${entry.id}`); load(); notifyTimerChange(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  if (!data) return null;
  // Running stopwatch: seconds counted by the server + time since the last refresh
  const live = data.running ? data.running.seconds + Math.max(0, Math.floor((now - data.loadedAt) / 1000)) : 0;
  const total = data.total + (data.running ? live - data.running.seconds : 0);

  return (
    <div className={panelCard}>
      <SectionTitle>Temps passé</SectionTitle>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xl font-bold text-ink-1 tabular-nums whitespace-nowrap">{fmtSeconds(total)}</span>
        <span className="text-[11px] text-ink-4">au total{data.mine ? ` · dont toi ${fmtSeconds(data.mine + (data.running ? live - data.running.seconds : 0))}` : ''}</span>
      </div>
      {canTrack && (
        <div className="mt-2.5">
          {data.running ? (
            <button onClick={() => act('stop')} className="w-full inline-flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25">
              <Square size={12} /> Arrêter · <span className="tabular-nums">{clock(live)}</span>
            </button>
          ) : open && (
            <button onClick={() => act('start')} className="w-full inline-flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
              <Play size={12} /> Démarrer le chrono
            </button>
          )}
          <form onSubmit={add} className="mt-2 flex gap-1.5">
            <input type="number" min={1} max={600} value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="min" aria-label="Minutes à ajouter"
              className="w-16 bg-surface border border-overlay/8 rounded-lg px-2 py-1.5 text-xs text-ink-1" />
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="Note (facultatif)" aria-label="Note du temps ajouté"
              className="flex-1 min-w-0 bg-surface border border-overlay/8 rounded-lg px-2 py-1.5 text-xs text-ink-1" />
            <button type="submit" disabled={!minutes} aria-label="Ajouter ce temps" className="px-2 rounded-lg border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-40"><Plus size={12} /></button>
          </form>
        </div>
      )}
      {data.byUser.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {data.byUser.map(u => (
            <li key={u.user_id} className="flex items-center gap-2"><Timer size={11} className="text-ink-4" /><span className="text-ink-2 flex-1 truncate">{u.user_tag}</span><span className="text-ink-1 tabular-nums">{fmtSeconds(u.seconds)}</span></li>
          ))}
        </ul>
      )}
      {data.entries.length > 0 && (
        <button onClick={() => setShowEntries(v => !v)} className="mt-2 text-[11px] text-ink-4 hover:text-ink-1 underline">{showEntries ? 'Masquer le détail' : 'Voir le détail'}</button>
      )}
      {showEntries && (
        <ul className="mt-2 space-y-1">
          {data.entries.map(e => (
            <li key={e.id} className="flex items-center gap-2 text-[11px] text-ink-3">
              <span className="flex-1 min-w-0 truncate">{e.user_tag} · {fmtDate(e.started_at)} · {e.running ? 'en cours' : fmtSeconds(e.seconds)}{e.source === 'manual' ? ' (ajouté)' : ''}{e.note ? ` — ${e.note}` : ''}</span>
              {(e.user_id === userId || isFounder) && !e.running && (
                <button onClick={() => remove(e)} aria-label="Retirer cette entrée" className="text-ink-4 hover:text-red-400"><Trash2 size={11} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
