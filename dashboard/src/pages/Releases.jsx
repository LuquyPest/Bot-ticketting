import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Rocket, Loader2, Plus, Check, Circle, X } from 'lucide-react';
import api from '../api';
import SignaturesPanel from '../components/SignaturesPanel';
import toast from 'react-hot-toast';

// Mises en production (v7, utils/releases.js): changes taken to production together, stage by stage
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
export const RELEASE_STATUS = { preparation: 'Préparation', test: 'Test', deployment: 'Déploiement', verification: 'Vérification', done: 'Terminée', rolled_back: 'Retour arrière', cancelled: 'Annulée' };
const STAGES = ['preparation', 'test', 'deployment', 'verification'];
const NEXT = { preparation: ['test', 'cancelled'], test: ['deployment', 'preparation', 'cancelled'], deployment: ['verification', 'rolled_back'], verification: ['done', 'rolled_back'], done: [], rolled_back: ['preparation'], cancelled: ['preparation'] };
const ACTION = { test: 'Passer au test', deployment: 'Déployer', verification: 'Passer à la vérification', done: 'Terminer', rolled_back: 'Revenir en arrière', cancelled: 'Annuler', preparation: 'Revenir en préparation' };
const CHANGE_STATUS = { draft: 'brouillon', pending: 'en validation', approved: 'approuvé', refused: 'refusé', in_progress: 'en cours', done: 'fait', failed: 'échoué', cancelled: 'annulé' };
const local = d => (d ? new Date(new Date(d).getTime() - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

function Detail({ id, staff, onChanged }) {
  const navigate = useNavigate();
  const [r, setR] = useState(null);
  const [step, setStep] = useState({ stage: 'preparation', title: '' });
  const [changeId, setChangeId] = useState('');
  useEffect(() => { api.get(`/releases/${id}`).then(x => setR(x.data)).catch(() => setR(false)); }, [id]);
  if (r === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (!r) return <p className="text-sm text-ink-4">Mise en production introuvable.</p>;
  const act = async (p, ok) => { try { const x = await p; setR(x.data); if (ok) toast.success(ok); onChanged?.(); return x.data; } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const text = (k, label, rows = 2) => (
    <label className="block text-[11px] font-semibold text-ink-3">{label}
      <textarea defaultValue={r[k]} rows={rows} maxLength={5000} onBlur={e => e.target.value !== r[k] && act(api.patch(`/releases/${id}`, { [k]: e.target.value }), 'Enregistré')} className={`${INPUT} mt-1 font-normal`} />
    </label>
  );
  const del = async () => { if (!window.confirm(`Supprimer « ${r.title} » ?`)) return; try { await api.delete(`/releases/${id}`); onChanged?.(); navigate('/mises-en-production'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className="space-y-3">
      <input defaultValue={r.title} maxLength={200} aria-label="Titre de la mise en production" onBlur={e => e.target.value.trim() && e.target.value !== r.title && act(api.patch(`/releases/${id}`, { title: e.target.value }), 'Enregistré')} className={`${INPUT} text-sm font-semibold`} />
      <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label="Étapes">
        {STAGES.map((s, i) => {
          const at = STAGES.indexOf(r.status);
          const state = r.status === 'done' || (at >= 0 && i < at) ? 'done' : s === r.status ? 'current' : 'todo';
          return <li key={s} aria-current={state === 'current' ? 'step' : undefined} className={`px-2 py-0.5 rounded-full border ${state === 'current' ? 'border-primary/50 bg-primary/10 text-ink-1' : state === 'done' ? 'border-emerald-500/30 text-emerald-300' : 'border-overlay/8 text-ink-4'}`}>{RELEASE_STATUS[s]}</li>;
        })}
        {['done', 'rolled_back', 'cancelled'].includes(r.status) && <li className="px-2 py-0.5 rounded-full border border-overlay/10 text-ink-2">{RELEASE_STATUS[r.status]}</li>}
      </ol>
      <div className="flex flex-wrap gap-1.5">
        {NEXT[r.status].map(s => <button key={s} type="button" onClick={() => act(api.post(`/releases/${id}/status`, { status: s }), RELEASE_STATUS[s])}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${['rolled_back', 'cancelled'].includes(s) ? 'border border-overlay/8 text-ink-2 hover:text-red-400' : 'bg-primary text-white'}`}>{ACTION[s]}</button>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <select value={r.assigneeId || ''} onChange={e => act(api.patch(`/releases/${id}`, { assigneeId: e.target.value || null }), 'Enregistré')} aria-label="Personne qui la mène" className={INPUT}>
          <option value="">Personne : aucune</option>{staff.map(s => <option key={s.user_id} value={s.user_id}>{`Personne : ${s.username}`}</option>)}
        </select>
        <input type="datetime-local" defaultValue={local(r.startsAt)} onBlur={e => act(api.patch(`/releases/${id}`, { startsAt: e.target.value ? new Date(e.target.value).toISOString() : null }))} aria-label="Début du créneau" className={INPUT} />
        <input type="datetime-local" defaultValue={local(r.endsAt)} onBlur={e => act(api.patch(`/releases/${id}`, { endsAt: e.target.value ? new Date(e.target.value).toISOString() : null }))} aria-label="Fin du créneau" className={INPUT} />
      </div>
      {text('description', 'Description')}
      {text('rollbackPlan', 'Plan de retour arrière')}
      <SignaturesPanel type="release" id={Number(id)} compact />
      <section className="space-y-1">
        <p className="text-[11px] font-semibold text-ink-3">{`Changements (${r.changes.length})`}</p>
        {r.changes.map(c => (
          <p key={c.id} className="flex items-center gap-1.5 text-xs">
            <Link to={`/changements/${c.id}`} className="text-ink-1 hover:underline">{`#${c.id} ${c.title}`}</Link>
            <span className={c.status === 'approved' || c.status === 'done' ? 'text-emerald-300' : 'text-ink-4'}>{`· ${CHANGE_STATUS[c.status] || c.status}`}</span>
            {['preparation', 'test'].includes(r.status) && <button type="button" onClick={() => act(api.delete(`/releases/${id}/changes/${c.id}`))} aria-label={`Retirer le changement #${c.id}`} className="ml-auto text-ink-4 hover:text-red-400"><X size={11} /></button>}
          </p>
        ))}
        {['preparation', 'test'].includes(r.status) && (
          <div className="flex gap-1.5"><input value={changeId} onChange={e => setChangeId(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="N° de changement" aria-label="Ajouter un changement" className={`${INPUT} w-36!`} />
            <button type="button" disabled={!changeId} onClick={() => act(api.post(`/releases/${id}/changes`, { changeId: Number(changeId) }), 'Changement ajouté').then(() => setChangeId(''))} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Ajouter</button></div>
        )}
      </section>
      <section className="space-y-2">
        <p className="text-[11px] font-semibold text-ink-3">Points à vérifier, par étape</p>
        {STAGES.map(s => {
          const list = r.steps.filter(x => x.stage === s);
          if (!list.length) return null;
          return (
            <div key={s}>
              <p className="text-[11px] text-ink-4">{RELEASE_STATUS[s]}</p>
              {list.map(k => (
                <div key={k.id} className="flex items-center gap-1.5 text-xs">
                  <button type="button" onClick={() => act(api.patch(`/releases/${id}/steps/${k.id}`, { done: !k.done }))} aria-label={k.done ? `Décocher « ${k.title} »` : `Cocher « ${k.title} »`} className="text-ink-3 hover:text-ink-1">
                    {k.done ? <Check size={12} className="text-emerald-300" /> : <Circle size={12} />}
                  </button>
                  <span className={k.done ? 'line-through text-ink-4' : 'text-ink-2'}>{k.title}</span>
                  {k.doneBy && <span className="text-ink-4">{`· ${k.doneBy}`}</span>}
                  <button type="button" onClick={() => act(api.delete(`/releases/${id}/steps/${k.id}`))} aria-label={`Retirer « ${k.title} »`} className="ml-auto text-ink-4 hover:text-red-400"><X size={11} /></button>
                </div>
              ))}
            </div>
          );
        })}
        <div className="flex flex-wrap gap-1.5">
          <select value={step.stage} onChange={e => setStep(x => ({ ...x, stage: e.target.value }))} aria-label="Étape du point" className={`${INPUT} w-36!`}>{STAGES.map(s => <option key={s} value={s}>{RELEASE_STATUS[s]}</option>)}</select>
          <input value={step.title} onChange={e => setStep(x => ({ ...x, title: e.target.value }))} maxLength={200} placeholder="Sauvegarde vérifiée…" aria-label="Nouveau point à vérifier" className={`${INPUT} flex-1`} />
          <button type="button" disabled={!step.title.trim()} onClick={() => act(api.post(`/releases/${id}/steps`, step)).then(() => setStep(x => ({ ...x, title: '' })))} aria-label="Ajouter le point" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={12} /></button>
        </div>
      </section>
      {text('review', 'Bilan (requis pour terminer)', 3)}
      {!['deployment', 'verification'].includes(r.status) && <button type="button" onClick={del} className="text-[11px] text-ink-4 hover:text-red-400 underline">Supprimer la mise en production</button>}
    </div>
  );
}

export default function Releases() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [off, setOff] = useState(false);
  const [staff, setStaff] = useState([]);
  const [title, setTitle] = useState('');
  const load = () => api.get('/releases').then(r => setList(r.data.releases || [])).catch(err => { if (err.response?.status === 404) setOff(true); setList([]); });
  useEffect(() => { load(); api.get('/tickets/staff').then(r => setStaff(r.data || [])).catch(() => {}); }, []);
  if (off) return (
    <div className="p-6 space-y-2 max-w-2xl">
      <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><Rocket size={20} className="text-primary-light" /> Mises en production</h1>
      <p className="text-sm text-ink-3">Les mises en production regroupent des changements : active d'abord les changements (menu Changements).</p>
    </div>
  );
  const create = async () => { try { const r = await api.post('/releases', { title }); setTitle(''); load(); navigate(`/mises-en-production/${r.data.id}`); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className="p-4 sm:p-6 grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><Rocket size={20} className="text-primary-light" /> Mises en production</h1>
        <div className="flex gap-1.5"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="Nouvelle mise en production" aria-label="Titre de la nouvelle mise en production" className={INPUT} />
          <button type="button" disabled={!title.trim()} onClick={create} aria-label="Créer la mise en production" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={13} /></button></div>
        {!list ? <Loader2 size={16} className="animate-spin text-ink-4" /> : (
          <ul className="space-y-1.5">
            {list.length === 0 && <li className="text-xs text-ink-4">Aucune mise en production.</li>}
            {list.map(r => (
              <li key={r.id}><Link to={`/mises-en-production/${r.id}`} className={`block rounded-xl border px-3 py-2 ${String(r.id) === id ? 'border-primary/40 bg-primary/5' : 'border-overlay/6 bg-surface-card hover:border-overlay/12'}`}>
                <p className="text-sm text-ink-1 truncate">{r.title}</p>
                <p className="text-[11px] text-ink-4">{`${RELEASE_STATUS[r.status]} · ${r.changes} changement(s)`}</p>
              </Link></li>
            ))}
          </ul>
        )}
      </div>
      <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4">{id ? <Detail key={id} id={id} staff={staff} onChanged={load} /> : <p className="text-sm text-ink-4">Choisis une mise en production.</p>}</div>
    </div>
  );
}
