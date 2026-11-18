import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

// Escalation levels (v5.1, utils/slaEscalation.js): at a share of an objective, actions.
// Used by the SLA objectives (first response, resolution) and by the teams (internal objective).
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1 text-xs focus:outline-hidden focus:border-primary';
const OBJ = { tto: 'Prise en charge', ttr: 'Résolution', ola: 'Objectif interne' };

export default function EscalationLevels({ value = [], onChange, objectives, teams = [], staff = [], excludeTeamId = null }) {
  const set = (i, k, v) => onChange(value.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const add = () => onChange([...value, { objective: objectives[0], percent: 100, notify: true, raisePriority: false, alertChannel: false, teamId: null, followerIds: [] }]);
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-ink-3">Escalade</p>
      {value.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-ink-2 bg-overlay/2.5 rounded-lg px-2 py-1.5" role="group" aria-label={`Niveau d'escalade ${i + 1}`}>
          {objectives.length > 1
            ? <select value={l.objective} onChange={e => set(i, 'objective', e.target.value)} aria-label="Objectif" className={INPUT}>{objectives.map(o => <option key={o} value={o}>{OBJ[o]}</option>)}</select>
            : <span>{OBJ[l.objective]}</span>}
          <span className="inline-flex items-center gap-1">à
            <input type="number" min={10} max={500} step={5} value={l.percent} onChange={e => set(i, 'percent', parseInt(e.target.value) || 0)} aria-label="Pourcentage du délai" className={`${INPUT} w-16`} /> %
          </span>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={l.notify} onChange={e => set(i, 'notify', e.target.checked)} className="accent-primary" />Prévenir</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={l.raisePriority} onChange={e => set(i, 'raisePriority', e.target.checked)} className="accent-primary" />Monter la priorité</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={l.alertChannel} onChange={e => set(i, 'alertChannel', e.target.checked)} className="accent-primary" />Salon d'escalade</label>
          {teams.length > 0 && (
            <select value={l.teamId || ''} onChange={e => set(i, 'teamId', e.target.value ? Number(e.target.value) : null)} aria-label="Passer à l'équipe" className={INPUT}>
              <option value="">Même équipe</option>
              {teams.filter(t => t.id !== excludeTeamId).map(t => <option key={t.id} value={t.id}>{`Passer à : ${t.name}`}</option>)}
            </select>
          )}
          {staff.length > 0 && (
            <select value="" onChange={e => e.target.value && set(i, 'followerIds', [...new Set([...l.followerIds, e.target.value])])} aria-label="Ajouter un observateur" className={INPUT}>
              <option value="">+ Observateur</option>
              {staff.filter(s => !l.followerIds.includes(s.user_id)).map(s => <option key={s.user_id} value={s.user_id}>{s.username}</option>)}
            </select>
          )}
          {l.followerIds.map(id => (
            <button key={id} type="button" onClick={() => set(i, 'followerIds', l.followerIds.filter(x => x !== id))} aria-label={`Retirer l'observateur ${staff.find(s => s.user_id === id)?.username || id}`}
              className="px-1.5 py-0.5 rounded-md border border-overlay/8 text-[11px] text-ink-2 hover:text-red-400">{staff.find(s => s.user_id === id)?.username || id} ×</button>
          ))}
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Supprimer le niveau" className="ml-auto p-1 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>
        </div>
      ))}
      {value.length < 6 && <button type="button" onClick={add} className="text-[11px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><Plus size={11} /> Ajouter un niveau</button>}
      <p className="text-[11px] text-ink-4">100 % = l'échéance ; 50 % = à mi-chemin ; 150 % = dépassée de moitié. Prévenir : les personnes attribuées, sinon l'équipe, sinon les fondateurs. Chaque niveau ne joue qu'une fois par ticket.</p>
    </div>
  );
}
