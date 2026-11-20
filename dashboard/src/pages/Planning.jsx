import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Link2, Loader2, Copy } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { uiLocale } from '../i18n';
import SharedPlannings from '../components/SharedPlannings';

const LANG_NAMES = { fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien', pt: 'portugais' };
const SLOT_INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs';
const localInput = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

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
  const [shared, setShared] = useState([]);
  const [skills, setSkills] = useState({ skills: [], languages: [] });
  const [slot, setSlot] = useState(null); // slot being written (shared planning)
  const isFounder = user?.role === 'fondateur';
  const loadShared = useCallback(() => api.get('/planning/shared').then(r => setShared(Array.isArray(r.data?.plannings) ? r.data.plannings : [])).catch(() => {}), []);
  useEffect(() => {
    api.get(isFounder ? '/teams' : '/teams/mine').then(r => setTeams(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    api.get('/tickets/staff').then(r => setStaff(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    api.get('/skills').then(r => setSkills({ skills: Array.isArray(r.data?.skills) ? r.data.skills : [], languages: Array.isArray(r.data?.languages) ? r.data.languages : [] })).catch(() => {});
    loadShared();
  }, [isFounder, loadShared]);
  const sharedId = scope.startsWith('shared:') ? Number(scope.slice(7)) : null;
  const current = shared.find(p => p.id === sharedId);
  const members = current ? staff.filter(s => current.userIds.includes(s.user_id) || teams.some(t => current.teamIds.includes(t.id) && (t.members || []).some(m => String(m.userId) === s.user_id))) : [];
  const saveSlot = async () => {
    try {
      const body = { ...slot, startsAt: new Date(slot.startsAt).toISOString(), endsAt: new Date(slot.endsAt).toISOString() };
      if (slot.id) await api.put(`/planning/shared/${sharedId}/slots/${slot.id}`, body); else await api.post(`/planning/shared/${sharedId}/slots`, body);
      toast.success('Créneau enregistré'); setSlot(null); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const deleteSlot = async () => {
    try { await api.delete(`/planning/shared/${sharedId}/slots/${slot.id}`); toast.success('Créneau supprimé'); setSlot(null); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const newSlot = day => { const a = new Date(day); a.setHours(9, 0, 0, 0); const b = new Date(day); b.setHours(18, 0, 0, 0); setSlot({ id: null, title: '', userId: '', skillId: '', startsAt: localInput(a), endsAt: localInput(b), weekly: false, until: '' }); };
  const load = useCallback(() => {
    const to = new Date(week.getTime() + 7 * 864e5);
    const [kind, ref] = scope.includes(':') ? [scope.slice(0, scope.indexOf(':')), scope.slice(scope.indexOf(':') + 1)] : [null, null];
    const params = { from: week.toISOString(), to: to.toISOString(), ...(kind ? { [kind]: ref } : {}) };
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
          {shared.map(p => <option key={`s${p.id}`} value={`shared:${p.id}`}>{`Planning commun : ${p.name}`}</option>)}
          {skills.skills.map(k => <option key={`k${k.id}`} value={`skill:${k.id}`}>{`Compétence : ${k.name}`}</option>)}
          {skills.languages.map(l => <option key={`l${l}`} value={`lang:${l}`}>{`Langue : ${LANG_NAMES[l] || l}`}</option>)}
          {staff.filter(s => s.user_id !== user?.id).map(s => <option key={s.user_id} value={`user:${s.user_id}`}>{s.username}</option>)}
        </select>
        <button type="button" onClick={() => setWeek(w => new Date(w.getTime() - 7 * 864e5))} aria-label="Semaine précédente" className="p-1.5 rounded-lg border border-overlay/8 text-ink-2"><ChevronLeft size={14} /></button>
        <button type="button" onClick={() => setWeek(startOfWeek(new Date()))} className="px-2.5 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2">Cette semaine</button>
        <button type="button" onClick={() => setWeek(w => new Date(w.getTime() + 7 * 864e5))} aria-label="Semaine suivante" className="p-1.5 rounded-lg border border-overlay/8 text-ink-2"><ChevronRight size={14} /></button>
      </div>
      {data?.coverage && (
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-7" aria-label="Couverture">
          {data.coverage.map(c => (
            <p key={c.day} title={c.absent.length ? `Absents : ${c.absent.join(', ')}` : undefined}
              className={`text-[11px] rounded-lg px-2 py-1 border ${c.present === 0 ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-overlay/6 text-ink-3'}`}>
              {`${new Date(c.day).toLocaleDateString(uiLocale(), { weekday: 'short' })} · ${c.present}/${c.total} présent(s)`}
            </p>
          ))}
        </div>
      )}
      {!data ? <Loader2 size={16} className="animate-spin text-ink-4" /> : (
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-7" role="region" aria-label="Semaine" tabIndex={0}>
          {days.map(day => {
            const today = sameDay(day, new Date());
            const tasks = data.tasks.filter(k => sameDay(new Date(k.dueAt), day));
            const deadlines = data.deadlines.filter(d => sameDay(new Date(d.dueAt), day));
            const changes = (data.changes || []).filter(c => new Date(c.startsAt) < new Date(day.getTime() + 864e5) && new Date(c.endsAt || c.startsAt) >= day);
            const absent = data.absences.filter(a => new Date(a.startsAt) < new Date(day.getTime() + 864e5) && new Date(a.endsAt) > day);
            const daySlots = (data.slots || []).filter(x => new Date(x.startsAt) < new Date(day.getTime() + 864e5) && new Date(x.endsAt) > day);
            return (
              <div key={day.toISOString()} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, day)}
                className={`min-h-32 rounded-xl border p-2 space-y-1.5 ${today ? 'border-primary/40 bg-primary/5' : 'border-overlay/6 bg-surface-card'}`}>
                <p className={`text-[11px] font-semibold ${today ? 'text-primary-light' : 'text-ink-3'}`}>{day.toLocaleDateString(uiLocale(), { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                {absent.map(a => <p key={a.id} className="text-[11px] rounded-md bg-amber-500/10 text-amber-300 px-1.5 py-0.5">{`Absence${a.username ? ` · ${a.username}` : ''}`}</p>)}
                {daySlots.map(x => (
                  <button key={`${x.key}-${day.getDate()}`} type="button" disabled={!sharedId}
                    onClick={() => setSlot({ id: x.id, title: x.title, userId: x.userId || '', skillId: x.skillId || '', startsAt: localInput(x.startsAt), endsAt: localInput(x.endsAt), weekly: x.weekly, until: x.until ? String(x.until).slice(0, 10) : '' })}
                    className="block w-full text-left text-[11px] rounded-md bg-violet-500/10 text-violet-300 px-1.5 py-0.5 enabled:hover:underline">
                    {`${time(x.startsAt)}–${time(x.endsAt)} · ${x.title}${x.username ? ` · ${x.username}` : ' · à pourvoir'}${sharedId ? '' : ` (${x.planning})`}`}
                  </button>
                ))}
                {sharedId && <button type="button" onClick={() => newSlot(day)} aria-label={`Ajouter un créneau le ${day.toLocaleDateString(uiLocale())}`} className="text-[11px] text-ink-4 hover:text-ink-1">+ créneau</button>}
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
      {slot && (
        <section className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2" aria-label="Créneau">
          <h2 className="text-sm font-semibold text-ink-2">{slot.id ? 'Modifier le créneau' : 'Nouveau créneau'}</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <input value={slot.title} onChange={e => setSlot(x => ({ ...x, title: e.target.value }))} placeholder="Intitulé (Astreinte, Accueil…)" aria-label="Intitulé du créneau" className={SLOT_INPUT} />
            <select value={slot.userId} onChange={e => setSlot(x => ({ ...x, userId: e.target.value }))} aria-label="Personne" className={SLOT_INPUT}>
              <option value="">À pourvoir</option>
              {members.map(s => <option key={s.user_id} value={s.user_id}>{s.username}</option>)}
            </select>
            <select value={slot.skillId} onChange={e => setSlot(x => ({ ...x, skillId: e.target.value }))} aria-label="Compétence demandée" className={SLOT_INPUT}>
              <option value="">Aucune compétence demandée</option>
              {skills.skills.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
            <input type="datetime-local" value={slot.startsAt} onChange={e => setSlot(x => ({ ...x, startsAt: e.target.value }))} aria-label="Début du créneau" className={SLOT_INPUT} />
            <input type="datetime-local" value={slot.endsAt} onChange={e => setSlot(x => ({ ...x, endsAt: e.target.value }))} aria-label="Fin du créneau" className={SLOT_INPUT} />
            <label className="inline-flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" checked={slot.weekly} onChange={e => setSlot(x => ({ ...x, weekly: e.target.checked }))} className="accent-primary" />Chaque semaine</label>
            {slot.weekly && <input type="date" value={slot.until} onChange={e => setSlot(x => ({ ...x, until: e.target.value }))} aria-label="Répéter jusqu'au" className={SLOT_INPUT} />}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={saveSlot} disabled={!slot.title.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Enregistrer le créneau</button>
            {slot.id && <button type="button" onClick={deleteSlot} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-red-400">Supprimer le créneau</button>}
            <button type="button" onClick={() => setSlot(null)} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-3">Annuler</button>
          </div>
        </section>
      )}
      <p className="text-xs text-ink-4">Glisse une tâche sur un autre jour pour la replanifier (même heure). En rouge : l'échéance de résolution d'un ticket attribué ; en violet : les créneaux des plannings communs.</p>
      {isFounder && <SharedPlannings plannings={shared} staff={staff} teams={teams} onChange={loadShared} />}
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
