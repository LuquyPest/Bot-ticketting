import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Bug, Loader2, Plus, Check, Circle } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';

// Problèmes (v5.5, utils/problems.js): the common cause of several tickets
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
export const PROBLEM_STATUS = { open: 'Ouvert', known_error: 'Erreur connue', resolved: 'Résolu', closed: 'Fermé' };

function Detail({ id, staff, onChanged }) {
  const [p, setP] = useState(null);
  const [task, setTask] = useState('');
  const [solution, setSolution] = useState('');
  const [all, setAll] = useState(true);
  const [ticketId, setTicketId] = useState('');
  useEffect(() => { api.get(`/problems/${id}`).then(r => setP(r.data)).catch(() => setP(false)); }, [id]);
  if (p === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (!p) return <p className="text-sm text-ink-4">Problème introuvable.</p>;
  const act = async (prom, ok) => { try { const r = await prom; setP(r.data); if (ok) toast.success(ok); onChanged?.(); return r.data; } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const field = (k, label, rows = 2) => (
    <label className="block text-[11px] font-semibold text-ink-3">{label}
      <textarea defaultValue={p[k]} rows={rows} maxLength={5000} onBlur={e => e.target.value !== p[k] && act(api.patch(`/problems/${id}`, { [k]: e.target.value }), 'Enregistré')} className={`${INPUT} mt-1 font-normal`} />
    </label>
  );
  return (
    <div className="space-y-3">
      <input defaultValue={p.title} maxLength={200} aria-label="Titre du problème" onBlur={e => e.target.value.trim() && e.target.value !== p.title && act(api.patch(`/problems/${id}`, { title: e.target.value }), 'Enregistré')} className={`${INPUT} text-sm font-semibold`} />
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={p.status} onChange={e => act(api.patch(`/problems/${id}`, { status: e.target.value }), 'Statut changé')} aria-label="Statut du problème" className={INPUT}>
          {Object.entries(PROBLEM_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={p.assigneeId || ''} onChange={e => act(api.patch(`/problems/${id}`, { assigneeId: e.target.value || null }), 'Enregistré')} aria-label="Personne qui s'en occupe" className={INPUT}>
          <option value="">Personne : aucune</option>{staff.map(s => <option key={s.user_id} value={s.user_id}>{`Personne : ${s.username}`}</option>)}
        </select>
      </div>
      {field('description', 'Description')}
      {field('symptoms', 'Symptômes')}
      {field('cause', 'Cause')}
      {field('workaround', 'Contournement (proposé sur les tickets reliés)')}
      <section className="space-y-1">
        <p className="text-[11px] font-semibold text-ink-3">Tâches</p>
        {p.tasks.map(k => (
          <button key={k.id} type="button" onClick={() => act(api.patch(`/problems/${id}/tasks/${k.id}`, { done: !k.done }))} className="flex items-center gap-1.5 text-xs text-ink-2">
            {k.done ? <Check size={12} className="text-emerald-300" /> : <Circle size={12} />}<span className={k.done ? 'line-through text-ink-4' : ''}>{k.title}</span></button>
        ))}
        <div className="flex gap-1.5"><input value={task} onChange={e => setTask(e.target.value)} maxLength={200} placeholder="Nouvelle tâche" aria-label="Nouvelle tâche du problème" className={INPUT} />
          <button type="button" disabled={!task.trim()} onClick={() => act(api.post(`/problems/${id}/tasks`, { title: task })).then(() => setTask(''))} aria-label="Ajouter la tâche" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={12} /></button></div>
      </section>
      <section className="space-y-1">
        <p className="text-[11px] font-semibold text-ink-3">{`Tickets reliés (${p.linked.length})`}</p>
        {p.linked.map(t => <p key={t.id} className="text-xs"><Link to={`/tickets/${t.id}`} className="text-ink-1 hover:underline">{`#${t.id} ${t.subject || ''}`}</Link> <span className="text-ink-4">{t.status === 'open' ? (t.resolved_at ? '· résolu' : '· ouvert') : '· fermé'}</span></p>)}
        <div className="flex gap-1.5"><input value={ticketId} onChange={e => setTicketId(e.target.value)} inputMode="numeric" placeholder="N° de ticket" aria-label="Relier un ticket" className={`${INPUT} w-28!`} />
          <button type="button" disabled={!ticketId} onClick={() => act(api.post(`/problems/${id}/tickets`, { ticketId: Number(ticketId) }), 'Ticket relié').then(() => setTicketId(''))} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1">Relier</button></div>
      </section>
      {p.status !== 'resolved' && p.status !== 'closed' && (
        <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-2">
          <p className="text-xs font-semibold text-emerald-300">Résoudre le problème</p>
          <textarea value={solution} onChange={e => setSolution(e.target.value)} rows={2} maxLength={2000} placeholder="La solution, envoyée aussi aux demandeurs" aria-label="Solution du problème" className={INPUT} />
          <label className="flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} className="accent-primary" />Proposer cette solution sur ses tickets ouverts</label>
          <button type="button" disabled={!solution.trim()} onClick={async () => { const d = await act(api.post(`/problems/${id}/resolve`, { solution, resolveTickets: all })); if (d) toast.success(`Problème résolu · ${d.result.resolved} ticket(s) résolu(s)${d.result.skipped ? `, ${d.result.skipped} non` : ''}`); }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50">Résoudre</button>
        </section>
      )}
      {p.solution && <p className="text-xs text-ink-2"><span className="font-semibold">Solution : </span>{p.solution}</p>}
    </div>
  );
}

export default function Problems() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(null);
  const [list, setList] = useState(null);
  const [staff, setStaff] = useState([]);
  const [title, setTitle] = useState('');
  const load = () => api.get('/problems').then(r => setList(r.data.problems)).catch(() => setList([]));
  useEffect(() => {
    api.get('/problems/settings').then(r => { setEnabled(r.data.enabled); if (r.data.enabled) load(); }).catch(() => setEnabled(false));
    api.get('/tickets/staff').then(r => setStaff(r.data || [])).catch(() => {});
  }, []);
  if (enabled === null) return <div className="p-6"><Loader2 size={16} className="animate-spin text-ink-4" /></div>;
  const toggle = async on => { await api.put('/problems/settings', { enabled: on }); setEnabled(on); if (on) load(); };
  if (!enabled) return (
    <div className="p-6 space-y-3 max-w-2xl">
      <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><Bug size={20} className="text-primary-light" /> Problèmes</h1>
      <p className="text-sm text-ink-3">Un problème est la cause commune de plusieurs tickets : symptômes, cause, contournement proposé aux demandeurs, tâches, et résolution de tous ses tickets d'un coup. Coupé tant que l'espace ne l'active pas.</p>
      {user?.role === 'fondateur' ? <button type="button" onClick={() => toggle(true)} className="px-3 py-2 rounded-lg text-xs font-semibold bg-primary text-white">Activer les problèmes</button>
        : <p className="text-xs text-ink-4">Un fondateur peut les activer.</p>}
    </div>
  );
  const create = async () => { try { const r = await api.post('/problems', { title }); setTitle(''); load(); navigate(`/problemes/${r.data.id}`); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className="p-4 sm:p-6 grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><Bug size={20} className="text-primary-light" /> Problèmes</h1>
        <div className="flex gap-1.5"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="Nouveau problème" aria-label="Titre du nouveau problème" className={INPUT} />
          <button type="button" disabled={!title.trim()} onClick={create} aria-label="Créer le problème" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={13} /></button></div>
        {!list ? <Loader2 size={16} className="animate-spin text-ink-4" /> : (
          <ul className="space-y-1.5">
            {list.length === 0 && <li className="text-xs text-ink-4">Aucun problème.</li>}
            {list.map(p => (
              <li key={p.id}><Link to={`/problemes/${p.id}`} className={`block rounded-xl border px-3 py-2 ${String(p.id) === id ? 'border-primary/40 bg-primary/5' : 'border-overlay/6 bg-surface-card hover:border-overlay/12'}`}>
                <p className="text-sm text-ink-1 truncate">{p.title}</p>
                <p className="text-[11px] text-ink-4">{`${PROBLEM_STATUS[p.status]} · ${p.openTickets}/${p.tickets} ticket(s) ouvert(s)`}</p>
              </Link></li>
            ))}
          </ul>
        )}
        {user?.role === 'fondateur' && <button type="button" onClick={() => toggle(false)} className="text-[11px] text-ink-4 hover:text-ink-2 underline">Couper les problèmes</button>}
      </div>
      <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4">{id ? <Detail key={id} id={id} staff={staff} onChanged={load} /> : <p className="text-sm text-ink-4">Choisis un problème.</p>}</div>
    </div>
  );
}
