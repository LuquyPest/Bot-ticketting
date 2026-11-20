import React, { useEffect, useState } from 'react';
import { ListChecks, ListPlus, Plus, Trash2, Check, Circle, Ban, Timer, Eye } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';

// Fiche ticket → Tâches (v5.4, utils/tasks.js): steps of work with a person, a duration, a date
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1 text-xs focus:outline-hidden focus:border-primary';
const fmtMin = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };

export default function TasksPanel({ ticketId, staff = [], canEdit, panelCard }) {
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [subFor, setSubFor] = useState(null);
  const [subTitle, setSubTitle] = useState('');
  // A missing or odd answer (older server, demo) shows nothing rather than breaking the ticket view
  const ok = d => (Array.isArray(d?.tasks) ? { tasks: d.tasks, progress: d.progress || { total: 0, done: 0 } } : false);
  const load = () => api.get(`/tickets/${ticketId}/tasks`).then(r => setData(ok(r.data))).catch(() => setData(false));
  useEffect(() => { load(); api.get('/task-templates').then(r => setTemplates(Array.isArray(r.data?.templates) ? r.data.templates : [])).catch(() => {}); }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  const act = async p => { try { const d = ok((await p).data); if (d) setData(d); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const add = () => act(api.post(`/tickets/${ticketId}/tasks`, { title, assigneeId: assignee || null })).then(() => { setTitle(''); setAssignee(''); });
  const next = { todo: 'done', done: 'todo', na: 'todo' };
  if (!data.tasks.length && !canEdit) return null;
  // Sub-tasks (v7): one level, shown under their task
  const ids = new Set(data.tasks.map(t => t.id));
  const top = data.tasks.filter(t => !t.parentId || !ids.has(t.parentId));
  const childrenOf = id => data.tasks.filter(t => t.parentId === id);
  const addSub = parentId => act(api.post(`/tickets/${ticketId}/tasks`, { title: subTitle, parentId })).then(() => { setSubTitle(''); setSubFor(null); });
  const taskRow = (t, subs = null) => (
    <div className="flex items-start gap-1.5">
      <button type="button" disabled={!canEdit} onClick={() => act(api.patch(`/tickets/${ticketId}/tasks/${t.id}`, { state: next[t.state] }))}
        aria-label={t.state === 'done' ? `Rouvrir « ${t.title} »` : `Marquer « ${t.title} » comme faite`} className="mt-0.5 text-ink-3 hover:text-ink-1 disabled:opacity-60">
        {t.state === 'done' ? <Check size={13} className="text-emerald-300" /> : t.state === 'na' ? <Ban size={13} /> : <Circle size={13} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`text-ink-1 ${t.state !== 'todo' ? 'line-through text-ink-4' : ''}`}>{t.title}</p>
        <p className="text-[11px] text-ink-4">
          {subs?.length > 0 && <span className="mr-1">{`${subs.filter(c => c.state !== 'todo').length}/${subs.length} sous-tâches`}</span>}
          {[t.assigneeName, t.dueAt && new Date(t.dueAt).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short' }),
            (t.plannedMinutes || t.spentSeconds) && `${fmtMin(t.spentSeconds)}${t.plannedMinutes ? ` / ${fmtMin(t.plannedMinutes * 60)}` : ''}`].filter(Boolean).join(' · ')}
          {t.visible && <Eye size={10} className="inline ml-1" aria-label="Visible du demandeur" />}
        </p>
      </div>
      {canEdit && subs && t.state === 'todo' && <button type="button" onClick={() => { setSubFor(t.id); setSubTitle(''); }} aria-label={`Ajouter une sous-tâche à « ${t.title} »`} title="Sous-tâche" className="p-0.5 text-ink-4 hover:text-ink-1"><ListPlus size={12} /></button>}
      {canEdit && t.state === 'todo' && <button type="button" onClick={() => act(api.post(`/tickets/${ticketId}/time/start`, { taskId: t.id }).then(() => api.get(`/tickets/${ticketId}/tasks`)))} aria-label={`Chronométrer « ${t.title} »`} title="Chronométrer" className="p-0.5 text-ink-4 hover:text-ink-1"><Timer size={12} /></button>}
      {canEdit && t.state === 'todo' && <button type="button" onClick={() => act(api.patch(`/tickets/${ticketId}/tasks/${t.id}`, { state: 'na' }))} aria-label={`« ${t.title} » sans objet`} title="Sans objet" className="p-0.5 text-ink-4 hover:text-ink-1"><Ban size={12} /></button>}
      {canEdit && <button type="button" onClick={() => act(api.delete(`/tickets/${ticketId}/tasks/${t.id}`))} aria-label={`Supprimer « ${t.title} »`} className="p-0.5 text-ink-4 hover:text-red-400"><Trash2 size={12} /></button>}
    </div>
  );
  return (
    <div className={panelCard}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-2 inline-flex items-center gap-1.5"><ListChecks size={12} aria-hidden="true" />
        {`Tâches${data.progress.total ? ` · ${data.progress.done}/${data.progress.total}` : ''}`}</p>
      <ul className="space-y-1.5">
        {top.map(t => {
          const subs = childrenOf(t.id);
          return (
            <li key={t.id} className="text-xs">
              {taskRow(t, subs)}
              {(subs.length > 0 || subFor === t.id) && (
                <ul className="mt-1 ml-4 pl-2 border-l border-overlay/8 space-y-1" aria-label={`Sous-tâches de « ${t.title} »`}>
                  {subs.map(c => <li key={c.id}>{taskRow(c)}</li>)}
                  {subFor === t.id && (
                    <li className="flex gap-1.5">
                      <input autoFocus value={subTitle} onChange={e => setSubTitle(e.target.value)} maxLength={200} placeholder="Nouvelle sous-tâche" aria-label={`Nouvelle sous-tâche de « ${t.title} »`}
                        onKeyDown={e => { if (e.key === 'Enter' && subTitle.trim()) addSub(t.id); if (e.key === 'Escape') setSubFor(null); }} className={INPUT} />
                      <button type="button" onClick={() => addSub(t.id)} disabled={!subTitle.trim()} aria-label="Ajouter la sous-tâche" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={12} /></button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <div className="mt-2 space-y-1.5">
          <div className="flex gap-1.5">
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="Nouvelle tâche" aria-label="Nouvelle tâche" onKeyDown={e => e.key === 'Enter' && title.trim() && add()} className={INPUT} />
            <button type="button" onClick={add} disabled={!title.trim()} aria-label="Ajouter la tâche" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={12} /></button>
          </div>
          <select value={assignee} onChange={e => setAssignee(e.target.value)} aria-label="Personne de la nouvelle tâche" className={INPUT}>
            <option value="">Personne : aucune</option>{staff.map(s => <option key={s.user_id} value={s.user_id}>{`Personne : ${s.username}`}</option>)}
          </select>
          {templates.length > 0 && (
            <select value="" onChange={e => e.target.value && act(api.post(`/tickets/${ticketId}/tasks`, { templateId: Number(e.target.value) }))} aria-label="Appliquer un modèle de tâches" className={INPUT}>
              <option value="">Appliquer un modèle…</option>{templates.map(t => <option key={t.id} value={t.id}>{`${t.name} (${t.tasks.length})`}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
