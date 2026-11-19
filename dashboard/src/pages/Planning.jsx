import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Link2, Loader2, Copy } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { uiLocale } from '../i18n';

// Planning (v5.4, utils/planning.js): the week of a person or a team — planned tasks (drag a task
// to another day to replan it), resolution deadlines of their tickets, absences — and an iCal link
const startOfWeek = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = d => new Date(d).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' });

export default function Planning() {
  const { user } = useAuth();
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const [scope, setScope] = useState('me');
  const [teams, setTeams] = useState([]);
  const [staff, setStaff] = useState([]);
  const [data, setData] = useState(null);
  const [ical, setIcal] = useState(null);
  const isFounder = user?.role === 'fondateur';
  useEffect(() => {
    api.get(isFounder ? '/teams' : '/teams/mine').then(r => setTeams(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    if (isFounder) api.get('/tickets/staff').then(r => setStaff(r.data || [])).catch(() => {});
  }, [isFounder]);
  const load = useCallback(() => {
    const to = new Date(week.getTime() + 7 * 864e5);
    const params = { from: week.toISOString(), to: to.toISOString(), ...(scope.startsWith('team:') ? { team: scope.slice(5) } : scope.startsWith('user:') ? { user: scope.slice(5) } : {}) };
    setData(null);
    api.get('/planning', { params }).then(r => setData(r.data)).catch(err => { setData({ tasks: [], deadlines: [], absences: [] }); toast.error(err.response?.data?.error || 'Erreur'); });
  }, [week, scope]);
  useEffect(() => { load(); }, [load]);
  const days = Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * 864e5));
  // Drop: same time of day, on the chosen day
  const drop = async (e, day) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/task')), ticketId = Number(e.dataTransfer.getData('text/ticket'));
    const task = data?.tasks.find(k => k.id === id);
    if (!task) return;
    const was = new Date(task.dueAt);
    const at = new Date(day); at.setHours(was.getHours(), was.getMinutes(), 0, 0);
    if (sameDay(at, was)) return;
    try { await api.patch(`/tickets/${ticketId}/tasks/${id}`, { dueAt: at.toISOString() }); toast.success('Tâche replanifiée'); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const makeIcal = async () => { try { setIcal((await api.post('/planning/ical')).data.url); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const dropIcal = async () => { await api.delete('/planning/ical').catch(() => null); setIcal(null); toast.success('Lien iCal retiré'); };
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2 mr-auto"><CalendarDays size={20} className="text-primary-light" /> Planning</h1>
        <select value={scope} onChange={e => setScope(e.target.value)} aria-label="Planning de" className="bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs">
          <option value="me">Mon planning</option>
          {teams.map(t => <option key={t.id} value={`team:${t.id}`}>{`Équipe : ${t.name}`}</option>)}
          {staff.filter(s => s.user_id !== user?.id).map(s => <option key={s.user_id} value={`user:${s.user_id}`}>{s.username}</option>)}
        </select>
        <button type="button" onClick={() => setWeek(w => new Date(w.getTime() - 7 * 864e5))} aria-label="Semaine précédente" className="p-1.5 rounded-lg border border-overlay/8 text-ink-2"><ChevronLeft size={14} /></button>
        <button type="button" onClick={() => setWeek(startOfWeek(new Date()))} className="px-2.5 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2">Cette semaine</button>
        <button type="button" onClick={() => setWeek(w => new Date(w.getTime() + 7 * 864e5))} aria-label="Semaine suivante" className="p-1.5 rounded-lg border border-overlay/8 text-ink-2"><ChevronRight size={14} /></button>
      </div>
      {!data ? <Loader2 size={16} className="animate-spin text-ink-4" /> : (
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-7" role="region" aria-label="Semaine" tabIndex={0}>
          {days.map(day => {
            const today = sameDay(day, new Date());
            const tasks = data.tasks.filter(k => sameDay(new Date(k.dueAt), day));
            const deadlines = data.deadlines.filter(d => sameDay(new Date(d.dueAt), day));
            const changes = (data.changes || []).filter(c => new Date(c.startsAt) < new Date(day.getTime() + 864e5) && new Date(c.endsAt || c.startsAt) >= day);
            const absent = data.absences.filter(a => new Date(a.startsAt) < new Date(day.getTime() + 864e5) && new Date(a.endsAt) > day);
            return (
              <div key={day.toISOString()} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, day)}
                className={`min-h-32 rounded-xl border p-2 space-y-1.5 ${today ? 'border-primary/40 bg-primary/5' : 'border-overlay/6 bg-surface-card'}`}>
                <p className={`text-[11px] font-semibold ${today ? 'text-primary-light' : 'text-ink-3'}`}>{day.toLocaleDateString(uiLocale(), { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                {absent.map(a => <p key={a.id} className="text-[11px] rounded-md bg-amber-500/10 text-amber-300 px-1.5 py-0.5">{`Absence${a.username ? ` · ${a.username}` : ''}`}</p>)}
                {tasks.map(k => (
                  <div key={k.id} draggable={k.state === 'todo'} onDragStart={e => { e.dataTransfer.setData('text/task', String(k.id)); e.dataTransfer.setData('text/ticket', String(k.ticketId)); }}
                    className={`text-[11px] rounded-md border border-overlay/8 px-1.5 py-1 ${k.state === 'todo' ? 'cursor-grab bg-surface' : 'opacity-60 line-through'}`}>
                    <p className="text-ink-1">{`${time(k.dueAt)} · ${k.title}`}</p>
                    <Link to={`/tickets/${k.ticketId}`} className="text-ink-4 hover:underline">{`#${k.ticketId}${k.assigneeName && scope !== 'me' ? ` · ${k.assigneeName}` : ''}`}</Link>
                  </div>
                ))}
                {changes.map(c => <Link key={`c${c.id}`} to={`/changements/${c.id}`} className="block text-[11px] rounded-md bg-sky-500/10 text-sky-300 px-1.5 py-0.5 hover:underline">{`${time(c.startsAt)} · changement : ${c.title}`}</Link>)}
                {deadlines.map(d => (
                  <Link key={`d${d.ticketId}`} to={`/tickets/${d.ticketId}`} className="block text-[11px] rounded-md bg-red-500/10 text-red-300 px-1.5 py-0.5 hover:underline">{`${time(d.dueAt)} · échéance #${d.ticketId}`}</Link>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-ink-4">Glisse une tâche sur un autre jour pour la replanifier (même heure). En rouge : l'échéance de résolution d'un ticket attribué.</p>
      <section className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2">
        <h2 className="text-sm font-semibold text-ink-2 flex items-center gap-2"><Link2 size={14} aria-hidden="true" /> Dans mon agenda (iCal)</h2>
        <p className="text-xs text-ink-3">Un lien secret à ajouter à Google Agenda, Outlook ou Calendrier : mes tâches planifiées, les échéances de mes tickets et mes absences. En créer un nouveau coupe l'ancien.</p>
        {ical && (
          <div className="flex items-center gap-2"><code className="text-[11px] break-all text-ink-2 bg-overlay/6 rounded px-1.5 py-1 flex-1">{ical}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(ical).then(() => toast.success('Copié'))} aria-label="Copier le lien iCal" className="p-1.5 text-ink-3 hover:text-ink-1"><Copy size={12} /></button></div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={makeIcal} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white">{ical ? 'Nouveau lien' : 'Créer mon lien iCal'}</button>
          <button type="button" onClick={dropIcal} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-3 hover:text-ink-1">Retirer mon lien</button>
        </div>
      </section>
    </div>
  );
}
