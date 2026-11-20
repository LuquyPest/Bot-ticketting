import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { GitPullRequestArrow, Loader2, Plus, Check, Circle, X } from 'lucide-react';
import AssetLinksPanel, { ChangeImpact } from '../components/AssetLinksPanel';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { uiLocale } from '../i18n';

// Changements (v5.5, utils/changes.js): planned changes, their plans, risks, approvals and window
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
export const CHANGE_STATUS = { draft: 'Brouillon', pending: 'En attente de validation', approved: 'Validé', refused: 'Refusé', in_progress: 'En cours', done: 'Terminé', failed: 'En échec', cancelled: 'Annulé' };
const NEXT = { draft: ['pending', 'cancelled'], pending: ['draft', 'cancelled'], approved: ['in_progress', 'cancelled'], refused: ['draft', 'cancelled'], in_progress: ['done', 'failed'], done: [], failed: ['draft'], cancelled: ['draft'] };
const NEXT_LABEL = { pending: 'Demander la validation', draft: 'Repasser en brouillon', cancelled: 'Annuler', in_progress: 'Démarrer', done: 'Terminé', failed: 'En échec' };
const local = d => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

function Detail({ id, staff, onChanged }) {
  const { user } = useAuth();
  const [c, setC] = useState(null);
  const [task, setTask] = useState('');
  const [approver, setApprover] = useState('');
  const [link, setLink] = useState('');
  useEffect(() => { api.get(`/changes/${id}`).then(r => setC(r.data)).catch(() => setC(false)); }, [id]);
  if (c === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (!c) return <p className="text-sm text-ink-4">Changement introuvable.</p>;
  const act = async (p, ok) => { try { const r = await p; setC(r.data); if (ok) toast.success(ok); onChanged?.(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const frozen = ['approved', 'in_progress', 'done'].includes(c.status);
  const text = (k, label) => (
    <label className="block text-[11px] font-semibold text-ink-3">{label}
      <textarea defaultValue={c[k]} rows={3} maxLength={5000} disabled={frozen && ['deployPlan', 'rollbackPlan', 'risks'].includes(k)} onBlur={e => e.target.value !== c[k] && act(api.patch(`/changes/${id}`, { [k]: e.target.value }), 'Enregistré')} className={`${INPUT} mt-1 font-normal disabled:opacity-60`} />
    </label>
  );
  const mine = c.approvals.find(a => a.approverId === user?.id && a.decision === 'pending');
  return (
    <div className="space-y-3">
      <input defaultValue={c.title} maxLength={200} aria-label="Titre du changement" onBlur={e => e.target.value.trim() && e.target.value !== c.title && act(api.patch(`/changes/${id}`, { title: e.target.value }), 'Enregistré')} className={`${INPUT} text-sm font-semibold`} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-ink-1">{CHANGE_STATUS[c.status]}</span>
        {NEXT[c.status].map(s => <button key={s} type="button" onClick={() => act(api.post(`/changes/${id}/status`, { status: s }), CHANGE_STATUS[s])} className="px-2.5 py-1 rounded-lg text-[11px] border border-overlay/8 text-ink-2 hover:text-ink-1">{NEXT_LABEL[s]}</button>)}
      </div>
      {mine && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-wrap items-center gap-2" role="group" aria-label="Ma validation">
          <span className="text-xs text-ink-1 flex-1">Ta validation est demandée.</span>
          <button type="button" onClick={() => act(api.post(`/changes/${id}/decide`, { decision: 'approved' }), 'Validé')} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-700 text-white">Valider</button>
          <button type="button" onClick={() => { const comment = window.prompt('Pourquoi ?') || ''; act(api.post(`/changes/${id}/decide`, { decision: 'refused', comment }), 'Refusé'); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-700 text-white">Refuser</button>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-4">
        <select value={c.risk} disabled={frozen} onChange={e => act(api.patch(`/changes/${id}`, { risk: e.target.value }))} aria-label="Niveau de risque" className={INPUT}>
          <option value="low">Risque faible</option><option value="medium">Risque moyen</option><option value="high">Risque élevé</option></select>
        <select value={c.assigneeId || ''} onChange={e => act(api.patch(`/changes/${id}`, { assigneeId: e.target.value || null }))} aria-label="Qui le mène" className={INPUT}>
          <option value="">Mené par : personne</option>{staff.map(s => <option key={s.user_id} value={s.user_id}>{`Mené par : ${s.username}`}</option>)}</select>
        <input type="datetime-local" defaultValue={local(c.startsAt)} onBlur={e => act(api.patch(`/changes/${id}`, { startsAt: e.target.value ? new Date(e.target.value).toISOString() : null }))} aria-label="Début du créneau" className={INPUT} />
        <input type="datetime-local" defaultValue={local(c.endsAt)} onBlur={e => act(api.patch(`/changes/${id}`, { endsAt: e.target.value ? new Date(e.target.value).toISOString() : null }))} aria-label="Fin du créneau" className={INPUT} />
      </div>
      {text('description', 'Description')}
      {text('deployPlan', 'Plan de déploiement')}
      {text('rollbackPlan', 'Plan de retour arrière')}
      {text('risks', 'Risques')}
      {text('impact', 'Impact (services, utilisateurs touchés)')}
      {c.release && <p className="text-xs text-ink-3">Mise en production : <Link to={`/mises-en-production/${c.release.id}`} className="text-primary-light hover:underline">{`#${c.release.id} ${c.release.title}`}</Link></p>}
      <AssetLinksPanel type="change" targetId={c.id} panelCard="space-y-1" />
      <ChangeImpact key={`impact-${c.id}`} changeId={c.id} />
      <section className="space-y-1">
        <p className="text-[11px] font-semibold text-ink-3">Validations</p>
        {c.approvals.map(a => (
          <p key={a.id} className="text-xs text-ink-2 flex items-center gap-1.5">{a.decision === 'approved' ? <Check size={12} className="text-emerald-300" /> : a.decision === 'refused' ? <X size={12} className="text-red-300" /> : <Circle size={12} />}
            {a.approverName}{a.comment ? ` — « ${a.comment} »` : ''}
            {['draft', 'refused'].includes(c.status) && <button type="button" onClick={() => act(api.delete(`/changes/${id}/approvers/${a.id}`))} aria-label={`Retirer ${a.approverName}`} className="text-ink-4 hover:text-red-400"><X size={11} /></button>}</p>
        ))}
        {['draft', 'refused'].includes(c.status) && (
          <div className="flex gap-1.5"><select value={approver} onChange={e => setApprover(e.target.value)} aria-label="Ajouter une validation" className={INPUT}><option value="">Ajouter une validation…</option>{staff.filter(s => !c.approvals.some(a => a.approverId === s.user_id)).map(s => <option key={s.user_id} value={s.user_id}>{s.username}</option>)}</select>
            <button type="button" disabled={!approver} onClick={() => act(api.post(`/changes/${id}/approvers`, { userId: approver })).then(() => setApprover(''))} aria-label="Ajouter la validation" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={12} /></button></div>
        )}
      </section>
      <section className="space-y-1">
        <p className="text-[11px] font-semibold text-ink-3">Tâches</p>
        {c.tasks.map(k => <button key={k.id} type="button" onClick={() => act(api.patch(`/changes/${id}/tasks/${k.id}`, { done: !k.done }))} className="flex items-center gap-1.5 text-xs text-ink-2">{k.done ? <Check size={12} className="text-emerald-300" /> : <Circle size={12} />}<span className={k.done ? 'line-through text-ink-4' : ''}>{k.title}</span></button>)}
        <div className="flex gap-1.5"><input value={task} onChange={e => setTask(e.target.value)} maxLength={200} placeholder="Nouvelle tâche" aria-label="Nouvelle tâche du changement" className={INPUT} />
          <button type="button" disabled={!task.trim()} onClick={() => act(api.post(`/changes/${id}/tasks`, { title: task })).then(() => setTask(''))} aria-label="Ajouter la tâche" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={12} /></button></div>
      </section>
      <section className="space-y-1">
        <p className="text-[11px] font-semibold text-ink-3">Tickets et problèmes traités</p>
        {c.tickets.map(t => <p key={`t${t.id}`} className="text-xs"><Link to={`/tickets/${t.id}`} className="text-ink-1 hover:underline">{`#${t.id} ${t.subject || ''}`}</Link></p>)}
        {c.problems.map(p => <p key={`p${p.id}`} className="text-xs"><Link to={`/problemes/${p.id}`} className="text-ink-1 hover:underline">{`Problème : ${p.title}`}</Link></p>)}
        <div className="flex gap-1.5"><input value={link} onChange={e => setLink(e.target.value)} inputMode="numeric" placeholder="N° de ticket" aria-label="Relier un ticket au changement" className={`${INPUT} w-28!`} />
          <button type="button" disabled={!link} onClick={() => act(api.post(`/changes/${id}/links`, { kind: 'ticket', targetId: Number(link) }), 'Ticket relié').then(() => setLink(''))} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1">Relier</button></div>
      </section>
    </div>
  );
}

export default function Changes() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(null);
  const [list, setList] = useState(null);
  const [staff, setStaff] = useState([]);
  const [title, setTitle] = useState('');
  const load = () => api.get('/changes').then(r => setList(r.data.changes)).catch(() => setList([]));
  useEffect(() => {
    api.get('/changes/settings').then(r => { setEnabled(r.data.enabled); if (r.data.enabled) load(); }).catch(() => setEnabled(false));
    api.get('/tickets/staff').then(r => setStaff(r.data || [])).catch(() => {});
  }, []);
  if (enabled === null) return <div className="p-6"><Loader2 size={16} className="animate-spin text-ink-4" /></div>;
  const toggle = async on => { await api.put('/changes/settings', { enabled: on }); setEnabled(on); if (on) load(); };
  if (!enabled) return (
    <div className="p-6 space-y-3 max-w-2xl">
      <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><GitPullRequestArrow size={20} className="text-primary-light" /> Changements</h1>
      <p className="text-sm text-ink-3">Un changement est une modification planifiée (mise à jour, migration) : plan de déploiement et de retour arrière, risques, validations par le staff, créneau dans le planning, tâches, tickets et problèmes qu'il traite. Coupé tant que l'espace ne l'active pas.</p>
      {user?.role === 'fondateur' ? <button type="button" onClick={() => toggle(true)} className="px-3 py-2 rounded-lg text-xs font-semibold bg-primary text-white">Activer les changements</button>
        : <p className="text-xs text-ink-4">Un fondateur peut les activer.</p>}
    </div>
  );
  const create = async () => { try { const r = await api.post('/changes', { title }); setTitle(''); load(); navigate(`/changements/${r.data.id}`); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className="p-4 sm:p-6 grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><GitPullRequestArrow size={20} className="text-primary-light" /> Changements</h1>
        <div className="flex gap-1.5"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="Nouveau changement" aria-label="Titre du nouveau changement" className={INPUT} />
          <button type="button" disabled={!title.trim()} onClick={create} aria-label="Créer le changement" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={13} /></button></div>
        {!list ? <Loader2 size={16} className="animate-spin text-ink-4" /> : (
          <ul className="space-y-1.5">
            {list.length === 0 && <li className="text-xs text-ink-4">Aucun changement.</li>}
            {list.map(c => (
              <li key={c.id}><Link to={`/changements/${c.id}`} className={`block rounded-xl border px-3 py-2 ${String(c.id) === id ? 'border-primary/40 bg-primary/5' : 'border-overlay/6 bg-surface-card hover:border-overlay/12'}`}>
                <p className="text-sm text-ink-1 truncate">{c.title}</p>
                <p className="text-[11px] text-ink-4">{[CHANGE_STATUS[c.status], c.startsAt && new Date(c.startsAt).toLocaleString(uiLocale(), { dateStyle: 'short', timeStyle: 'short' })].filter(Boolean).join(' · ')}</p>
              </Link></li>
            ))}
          </ul>
        )}
        {user?.role === 'fondateur' && <button type="button" onClick={() => toggle(false)} className="text-[11px] text-ink-4 hover:text-ink-2 underline">Couper les changements</button>}
      </div>
      <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4">{id ? <Detail key={id} id={id} staff={staff} onChanged={load} /> : <p className="text-sm text-ink-4">Choisis un changement.</p>}</div>
    </div>
  );
}
