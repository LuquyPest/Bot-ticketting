import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Gavel, Loader2, Plus, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { uiLocale } from '../i18n';

// Comité des changements (v7, utils/cab.js): members, meetings, agenda, opinions and decisions
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const VOTE = { for: 'Pour', against: 'Contre', reserve: 'Réserve' };
export const CAB_DECISION = { approved: 'Approuvé', refused: 'Refusé', postponed: 'Reporté' };
const MEETING_STATUS = { planned: 'Prévue', held: 'Tenue', cancelled: 'Annulée' };
const fmt = d => new Date(d).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' });

function Meeting({ id, me, canRun, onChanged }) {
  const navigate = useNavigate();
  const [m, setM] = useState(null);
  const [changeId, setChangeId] = useState('');
  const [notes, setNotes] = useState({});
  useEffect(() => { api.get(`/cab/meetings/${id}`).then(r => setM(r.data)).catch(() => setM(false)); }, [id]);
  if (m === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (!m) return <p className="text-sm text-ink-4">Réunion introuvable.</p>;
  const act = async (p, ok) => { try { const r = await p; setM(r.data); if (ok) toast.success(ok); onChanged?.(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const save = patch => act(api.put(`/cab/meetings/${id}`, { title: m.title, startsAt: m.startsAt, status: m.status, notes: m.notes, ...patch }), 'Enregistré');
  const del = async () => { if (!window.confirm(`Supprimer la réunion « ${m.title} » ?`)) return; try { await api.delete(`/cab/meetings/${id}`); onChanged?.(); navigate('/comite'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink-1">{m.title}</h2>
        <span className="text-xs text-ink-4">{`${fmt(m.startsAt)} · ${MEETING_STATUS[m.status]}`}</span>
        {canRun && m.status === 'planned' && <button type="button" onClick={() => save({ status: 'held' })} className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1">Marquer comme tenue</button>}
        {canRun && m.status === 'planned' && <button type="button" onClick={() => save({ status: 'cancelled' })} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-3 hover:text-red-400">Annuler</button>}
      </div>
      <section className="space-y-2">
        <p className="text-[11px] font-semibold text-ink-3">{`Ordre du jour (${m.agenda.length})`}</p>
        {m.agenda.length === 0 && <p className="text-xs text-ink-4">Aucun changement à l'ordre du jour.</p>}
        {m.agenda.map(a => {
          const mine = a.votes.find(v => String(v.userId) === String(me));
          return (
            <div key={a.changeId} className="rounded-xl border border-overlay/6 p-3 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Link to={`/changements/${a.changeId}`} className="font-medium text-ink-1 hover:underline">{`#${a.changeId} ${a.title}`}</Link>
                {a.risk && <span className="text-ink-4">{`· risque ${a.risk === 'high' ? 'élevé' : a.risk === 'medium' ? 'moyen' : 'faible'}`}</span>}
                {a.decision && <span className={`ml-auto px-2 py-0.5 rounded-full text-[11px] ${a.decision === 'approved' ? 'bg-emerald-500/15 text-emerald-300' : a.decision === 'refused' ? 'bg-red-500/15 text-red-300' : 'bg-overlay/6 text-ink-2'}`}>{CAB_DECISION[a.decision]}</span>}
                {!a.decision && canRun && m.status === 'planned' && <button type="button" onClick={() => act(api.delete(`/cab/meetings/${id}/agenda/${a.changeId}`))} aria-label={`Retirer le changement #${a.changeId}`} className="ml-auto text-ink-4 hover:text-red-400"><X size={11} /></button>}
              </div>
              {a.votes.length > 0 && <ul className="text-[11px] text-ink-3 space-y-0.5">{a.votes.map(v => <li key={v.userId}>{`${v.username} : ${VOTE[v.vote]}${v.comment ? ` — ${v.comment}` : ''}`}</li>)}</ul>}
              {!a.decision && m.status !== 'cancelled' && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[11px] text-ink-4">Mon avis :</span>
                  {Object.entries(VOTE).map(([k, l]) => <button key={k} type="button" aria-pressed={mine?.vote === k} onClick={() => act(api.post(`/cab/meetings/${id}/agenda/${a.changeId}/vote`, { vote: k, comment: notes[a.changeId] || mine?.comment || '' }), 'Avis enregistré')}
                    className={`px-2 py-0.5 rounded-md text-[11px] border ${mine?.vote === k ? 'border-primary/40 bg-primary/10 text-ink-1' : 'border-overlay/8 text-ink-3 hover:text-ink-1'}`}>{l}</button>)}
                  <input value={notes[a.changeId] ?? ''} onChange={e => setNotes(n => ({ ...n, [a.changeId]: e.target.value }))} maxLength={1000} placeholder="Commentaire" aria-label={`Commentaire sur le changement #${a.changeId}`} className={`${INPUT} flex-1 min-w-40`} />
                </div>
              )}
              {!a.decision && canRun && m.status !== 'cancelled' && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[11px] text-ink-4">Décision du comité :</span>
                  {Object.entries(CAB_DECISION).map(([k, l]) => <button key={k} type="button" onClick={() => window.confirm(`${l} : changement #${a.changeId} ?`) && act(api.post(`/cab/meetings/${id}/agenda/${a.changeId}/decide`, { decision: k, note: notes[a.changeId] || '' }), l)}
                    className="px-2 py-0.5 rounded-md text-[11px] border border-overlay/8 text-ink-2 hover:text-ink-1">{l}</button>)}
                </div>
              )}
              {a.decision && (a.decisionNote || a.decidedBy) && <p className="text-[11px] text-ink-3">{[a.decisionNote, a.decidedBy && `par ${a.decidedBy}`].filter(Boolean).join(' · ')}</p>}
            </div>
          );
        })}
        {canRun && m.status === 'planned' && (
          <div className="flex gap-1.5"><input value={changeId} onChange={e => setChangeId(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="N° de changement" aria-label="Ajouter un changement à l'ordre du jour" className={`${INPUT} w-36!`} />
            <button type="button" disabled={!changeId} onClick={() => act(api.post(`/cab/meetings/${id}/agenda`, { changeId: Number(changeId) }), 'Ajouté à l\'ordre du jour').then(() => setChangeId(''))} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Ajouter</button></div>
        )}
      </section>
      <label className="block text-[11px] font-semibold text-ink-3">Compte rendu
        <textarea defaultValue={m.notes} rows={4} maxLength={10000} disabled={!canRun} onBlur={e => canRun && e.target.value !== m.notes && save({ notes: e.target.value })} className={`${INPUT} mt-1 font-normal`} />
      </label>
      {canRun && <button type="button" onClick={del} className="text-[11px] text-ink-4 hover:text-red-400 underline">Supprimer la réunion</button>}
    </div>
  );
}

export default function Cab() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [off, setOff] = useState(false);
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState({ title: '', startsAt: '' });
  const load = () => api.get('/cab').then(r => setData(r.data)).catch(err => { if (err.response?.status === 404) setOff(true); setData({ members: [], meetings: [], member: false }); });
  useEffect(() => { load(); api.get('/tickets/staff').then(r => setStaff(r.data || [])).catch(() => {}); }, []);
  if (off) return (
    <div className="p-6 space-y-2 max-w-2xl">
      <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><Gavel size={20} className="text-primary-light" /> Comité des changements</h1>
      <p className="text-sm text-ink-3">Le comité examine les changements : active d'abord les changements (menu Changements).</p>
    </div>
  );
  if (!data) return <div className="p-6"><Loader2 size={16} className="animate-spin text-ink-4" /></div>;
  const founder = user?.role === 'fondateur';
  const canRun = founder || data.member;
  const canMembers = founder || user?.permissions?.includes('manage_settings');
  const toggleMember = async uid => {
    const ids = data.members.map(m => m.userId);
    try { const r = await api.put('/cab/members', { members: ids.includes(uid) ? ids.filter(x => x !== uid) : [...ids, uid] }); setData(d => ({ ...d, members: r.data.members, member: r.data.members.some(m => String(m.userId) === String(user?.id)) })); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const create = async () => {
    try { const r = await api.post('/cab/meetings', { title: form.title, startsAt: new Date(form.startsAt).toISOString() }); setForm({ title: '', startsAt: '' }); load(); navigate(`/comite/${r.data.id}`); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  return (
    <div className="p-4 sm:p-6 grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><Gavel size={20} className="text-primary-light" /> Comité des changements</h1>
        <section className="space-y-1">
          <p className="text-[11px] font-semibold text-ink-3">Membres</p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Membres du comité">
            {(canMembers ? staff : data.members.map(m => ({ user_id: m.userId, username: m.username }))).map(s => {
              const on = data.members.some(m => String(m.userId) === String(s.user_id));
              return <button key={s.user_id} type="button" aria-pressed={on} disabled={!canMembers} onClick={() => toggleMember(String(s.user_id))}
                className={`px-2 py-0.5 rounded-md text-[11px] border ${on ? 'border-primary/40 bg-primary/10 text-ink-1' : 'border-overlay/8 text-ink-3 hover:text-ink-1'} disabled:cursor-default`}>{s.username}</button>;
            })}
          </div>
        </section>
        {canRun && (
          <div className="space-y-1.5">
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} maxLength={150} placeholder="Comité du mardi" aria-label="Titre de la nouvelle réunion" className={INPUT} />
            <div className="flex gap-1.5">
              <input type="datetime-local" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} aria-label="Date de la nouvelle réunion" className={INPUT} />
              <button type="button" disabled={!form.title.trim() || !form.startsAt} onClick={create} aria-label="Planifier la réunion" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={13} /></button>
            </div>
          </div>
        )}
        <ul className="space-y-1.5">
          {data.meetings.length === 0 && <li className="text-xs text-ink-4">Aucune réunion.</li>}
          {data.meetings.map(m => (
            <li key={m.id}><Link to={`/comite/${m.id}`} className={`block rounded-xl border px-3 py-2 ${String(m.id) === id ? 'border-primary/40 bg-primary/5' : 'border-overlay/6 bg-surface-card hover:border-overlay/12'}`}>
              <p className="text-sm text-ink-1 truncate">{m.title}</p>
              <p className="text-[11px] text-ink-4">{`${fmt(m.startsAt)} · ${MEETING_STATUS[m.status]} · ${m.items} changement(s)`}</p>
            </Link></li>
          ))}
        </ul>
      </div>
      <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4">{id ? <Meeting key={id} id={id} me={user?.id} canRun={canRun} onChanged={load} /> : <p className="text-sm text-ink-4">Choisis une réunion.</p>}</div>
    </div>
  );
}
