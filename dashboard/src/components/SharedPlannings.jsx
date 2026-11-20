import React, { useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Planning → Plannings communs (v8, utils/sharedPlanning.js): founders create a shared planning
// (« Astreinte », « Permanence N1 »…) and choose its people and teams
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const EMPTY = { id: null, name: '', description: '', userIds: [], teamIds: [] };

export default function SharedPlannings({ plannings, staff, teams, onChange }) {
  const [f, setF] = useState(EMPTY);
  const toggle = (k, v) => setF(x => ({ ...x, [k]: x[k].includes(v) ? x[k].filter(y => y !== v) : [...x[k], v] }));
  const save = async () => {
    try {
      if (f.id) await api.put(`/planning/shared/${f.id}`, f); else await api.post('/planning/shared', f);
      toast.success('Planning commun enregistré'); setF(EMPTY); onChange();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const remove = async p => {
    if (!window.confirm(`Supprimer le planning « ${p.name} » et ses créneaux ?`)) return;
    try { await api.delete(`/planning/shared/${p.id}`); toast.success('Planning commun supprimé'); onChange(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  return (
    <section className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-ink-2 flex items-center gap-2"><Users size={14} aria-hidden="true" /> Plannings communs</h2>
      <p className="text-xs text-ink-3">Un planning partagé par des personnes et des équipes — astreinte, permanence, accueil… Ses membres y posent des créneaux, répétables chaque semaine ; chacun retrouve les siens dans son planning et son agenda iCal.</p>
      {plannings.length > 0 && (
        <ul className="space-y-1">
          {plannings.map(p => (
            <li key={p.id} className="flex items-center gap-2 text-xs">
              <button type="button" onClick={() => setF({ ...EMPTY, ...p })} className="text-ink-1 hover:underline">{p.name}</button>
              <span className="text-ink-4">{`${p.userIds.length} personne(s) · ${p.teamIds.length} équipe(s)`}</span>
              <button type="button" onClick={() => remove(p)} aria-label={`Supprimer le planning « ${p.name} »`} className="ml-auto text-ink-4 hover:text-red-400"><Trash2 size={12} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} placeholder="Nom (Astreinte, Permanence N1…)" aria-label="Nom du planning commun" className={INPUT} />
        <input value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} placeholder="Description (facultatif)" aria-label="Description du planning commun" className={INPUT} />
      </div>
      <fieldset className="text-xs text-ink-2">
        <legend className="text-[11px] text-ink-3 mb-1">Membres</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {teams.map(t => <label key={`t${t.id}`} className="inline-flex items-center gap-1"><input type="checkbox" checked={f.teamIds.includes(t.id)} onChange={() => toggle('teamIds', t.id)} className="accent-primary" />{`Équipe : ${t.name}`}</label>)}
          {staff.map(s => <label key={s.user_id} className="inline-flex items-center gap-1"><input type="checkbox" checked={f.userIds.includes(s.user_id)} onChange={() => toggle('userIds', s.user_id)} className="accent-primary" />{s.username}</label>)}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={!f.name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white inline-flex items-center gap-1 disabled:opacity-50"><Plus size={12} />{f.id ? 'Enregistrer le planning' : 'Créer le planning'}</button>
        {f.id && <button type="button" onClick={() => setF(EMPTY)} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-3">Annuler</button>}
      </div>
    </section>
  );
}
