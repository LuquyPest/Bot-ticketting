import React, { useCallback, useEffect, useState } from 'react';
import { CalendarOff, Loader2, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';
import { confirmToast } from '../utils/confirmToast';

const input = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-sm focus:outline-hidden focus:border-primary/50';
const fmt = d => new Date(d).toLocaleString(uiLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
// <input type="datetime-local"> value for a Date, in local time
const localInput = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

// Planned absences: vacation mode turns on at the start and off at the end by itself.
// team: the Équipe page (managers plan for anyone, and see everyone's)
export default function Absences({ team = false, staff = [] }) {
  const [data, setData] = useState(null);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
  const later = new Date(tomorrow); later.setDate(later.getDate() + 7); later.setHours(18, 0, 0, 0);
  const [form, setForm] = useState({ userId: '', startsAt: localInput(tomorrow), endsAt: localInput(later), reason: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/absences').then(r => setData({ current: Array.isArray(r.data?.current) ? r.data.current : [], canManage: !!r.data?.canManage }))
      .catch(() => setData({ current: [], canManage: false }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/absences', {
        ...(team && form.userId ? { userId: form.userId } : {}),
        startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), reason: form.reason.trim() || null,
      });
      toast.success('Absence planifiée : le mode vacances s\'activera et se retirera tout seul');
      setForm(f => ({ ...f, reason: '' }));
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setBusy(false); }
  };
  const remove = async (a) => {
    if (!await confirmToast(a.state === 'active' ? 'Mettre fin à cette absence maintenant ?' : 'Annuler cette absence ?')) return;
    try { await api.delete(`/absences/${a.id}`); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  const rows = data ? data.current : [];
  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        {team && data?.canManage && staff.length > 0 && (
          <label className="text-xs text-ink-3 space-y-1"><span className="block">Membre</span>
            <select value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))} className={input}>
              <option value="">Moi</option>
              {staff.map(s => <option key={s.user_id} value={s.user_id}>{s.username}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-ink-3 space-y-1"><span className="block">Du</span>
          <input type="datetime-local" required value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} className={input} />
        </label>
        <label className="text-xs text-ink-3 space-y-1"><span className="block">Au</span>
          <input type="datetime-local" required value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} className={input} />
        </label>
        <label className="text-xs text-ink-3 space-y-1 flex-1 min-w-40"><span className="block">Motif (facultatif)</span>
          <input value={form.reason} maxLength={160} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Vacances" className={`${input} w-full`} />
        </label>
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarOff size={14} />} Planifier
        </button>
      </form>
      {data && (rows.length ? (
        <ul className="divide-y divide-overlay/6 rounded-xl border border-overlay/6">
          {rows.map(a => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              {team && <span className="text-ink-1 font-medium" translate="no">{a.username}</span>}
              <span className="text-ink-2">{fmt(a.starts_at)} → {fmt(a.ends_at)}</span>
              {a.reason && <span className="text-ink-3 text-xs" translate="no">· {a.reason}</span>}
              <span className={`text-[11px] font-semibold ${a.state === 'active' ? 'text-amber-400' : 'text-ink-4'}`}>{a.state === 'active' ? 'En cours' : 'Prévue'}</span>
              <button onClick={() => remove(a)} aria-label={a.state === 'active' ? 'Terminer l\'absence' : 'Annuler l\'absence'} title={a.state === 'active' ? 'Terminer maintenant' : 'Annuler'}
                className="ml-auto text-ink-4 hover:text-red-400"><X size={14} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-ink-4">Aucune absence prévue.</p>)}
    </div>
  );
}
