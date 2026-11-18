import React, { useEffect, useState } from 'react';
import { Timer, Loader2, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import EscalationLevels from './EscalationLevels';

// Paramètres → Horaires → Objectifs SLA (v5.1): time to first response and to resolution, in
// business hours of the ticket's calendar; the most precise objective wins (utils/slaPolicies.js)
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const PRIO = [['low', 'Basse'], ['normal', 'Normale'], ['urgent', 'Urgente']];
const TYPES = [['incident', 'Incident'], ['request', 'Demande']];
const CHANNELS = [['discord', 'Discord'], ['email', 'E-mail'], ['web', 'Web']];

function Duration({ value, onChange, label }) {
  const h = value ? Math.floor(value / 60) : '', m = value ? value % 60 : '';
  const set = (hh, mm) => { const total = (parseInt(hh) || 0) * 60 + (parseInt(mm) || 0); onChange(total > 0 ? total : null); };
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-3">{label}
      <input type="number" min={0} max={8760} value={h} onChange={e => set(e.target.value, m)} aria-label={`${label} : heures`} className={`${INPUT} w-16`} /> h
      <input type="number" min={0} max={59} value={m} onChange={e => set(h, e.target.value)} aria-label={`${label} : minutes`} className={`${INPUT} w-14`} /> min
    </span>
  );
}
function Chips({ label, options, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      <span className="text-[11px] text-ink-4 w-20">{label}</span>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value.includes(v)} onClick={() => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])}
          className={`px-2 py-0.5 rounded-md text-[11px] border ${value.includes(v) ? 'bg-primary/15 text-primary-light border-primary/40' : 'border-overlay/8 text-ink-3 hover:text-ink-1'}`}>{l}</button>
      ))}
      {!value.length && <span className="text-[11px] text-ink-4">tous</span>}
    </div>
  );
}

function PolicyForm({ initial, subjects, teams, staff, onSave, onDelete, onMove, busy }) {
  const [p, setP] = useState(initial);
  const set = (k, v) => setP(x => ({ ...x, [k]: v }));
  const setC = (k, v) => setP(x => ({ ...x, conditions: { ...x.conditions, [k]: v } }));
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input value={p.name} onChange={e => set('name', e.target.value)} maxLength={60} placeholder="Clients urgents" aria-label="Nom de l'objectif" className={`${INPUT} flex-1 min-w-40`} />
        <label className="flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" checked={p.active} onChange={e => set('active', e.target.checked)} className="accent-primary" />Actif</label>
        {onMove && <><button type="button" onClick={() => onMove(-1)} aria-label="Monter" className="p-1 text-ink-3 hover:text-ink-1"><ArrowUp size={12} /></button><button type="button" onClick={() => onMove(1)} aria-label="Descendre" className="p-1 text-ink-3 hover:text-ink-1"><ArrowDown size={12} /></button></>}
      </div>
      <div className="flex flex-wrap gap-4">
        <Duration label="Prise en charge" value={p.ttoMinutes} onChange={v => set('ttoMinutes', v)} />
        <Duration label="Résolution" value={p.ttrMinutes} onChange={v => set('ttrMinutes', v)} />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" checked={p.businessHours} onChange={e => set('businessHours', e.target.checked)} className="accent-primary" />En heures ouvrées (calendrier de l'équipe du ticket, sinon de l'espace)</label>
      <Chips label="Priorités" options={PRIO} value={p.conditions.priorities} onChange={v => setC('priorities', v)} />
      <Chips label="Types" options={TYPES} value={p.conditions.types} onChange={v => setC('types', v)} />
      <Chips label="Canaux" options={CHANNELS} value={p.conditions.channels} onChange={v => setC('channels', v)} />
      {subjects.length > 0 && <Chips label="Sujets" options={subjects.filter(s => !s.includes(' › ')).map(s => [s, s])} value={p.conditions.subjects} onChange={v => setC('subjects', v)} />}
      <EscalationLevels value={p.escalations || []} onChange={v => set('escalations', v)} objectives={['tto', 'ttr']} teams={teams} staff={staff} />
      <div className="flex gap-2">
        <button onClick={() => onSave(p)} disabled={busy || !p.name.trim() || !(p.ttoMinutes || p.ttrMinutes)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 size={12} className="animate-spin" />}{initial.id ? 'Enregistrer' : 'Créer l\'objectif'}
        </button>
        {onDelete && <button onClick={onDelete} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs text-ink-3 hover:text-red-400 border border-overlay/8 inline-flex items-center gap-1.5"><Trash2 size={12} /> Supprimer</button>}
      </div>
    </div>
  );
}

const NEW = { name: '', ttoMinutes: 240, ttrMinutes: 1440, businessHours: true, active: true, conditions: { priorities: [], types: [], subjects: [], channels: [] }, escalations: [] };

export default function SlaPoliciesEditor() {
  const [list, setList] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState(0);
  useEffect(() => {
    api.get('/sla-policies').then(r => setList(r.data.policies)).catch(() => setList(false));
    api.get('/teams/options').then(r => setSubjects(r.data?.subjects || [])).catch(() => {});
    api.get('/teams').then(r => setTeams(r.data || [])).catch(() => {});
    api.get('/tickets/staff').then(r => setStaff(r.data || [])).catch(() => {});
  }, []);
  if (list === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (list === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); setList(r.data.policies); toast.success(ok); setAdding(false); setKey(k => k + 1); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const body = p => ({ name: p.name, ttoMinutes: p.ttoMinutes, ttrMinutes: p.ttrMinutes, businessHours: p.businessHours, active: p.active, conditions: p.conditions, escalations: p.escalations || [] });
  const move = (i, d) => { const ids = list.map(p => p.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; run(() => api.put('/sla-policies/order', { ids }), 'Ordre enregistré'); };
  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-ink-3 inline-flex items-start gap-2"><Timer size={16} className="shrink-0 mt-0.5 text-primary-light" aria-hidden="true" />
        Les objectifs SLA : délai de prise en charge (première réponse) et de résolution. La résolution est en pause quand le ticket attend le demandeur. Un objectif prend les tickets qui remplissent tous ses critères (vide = tous) ; le plus précis l'emporte, puis le premier de la liste. Les délais par étape (Paramètres → Tickets) restent à part.
      </p>
      {list.map((p, i) => (
        <PolicyForm key={`${p.id}-${key}`} initial={p} subjects={subjects} teams={teams} staff={staff} busy={busy} onMove={list.length > 1 ? d => move(i, d) : null}
          onSave={v => run(() => api.put(`/sla-policies/${p.id}`, body(v)), 'Objectif enregistré')}
          onDelete={() => window.confirm(`Supprimer l'objectif « ${p.name} » ?`) && run(() => api.delete(`/sla-policies/${p.id}`), 'Objectif supprimé')} />
      ))}
      {adding ? <PolicyForm key={`new-${key}`} initial={NEW} subjects={subjects} teams={teams} staff={staff} busy={busy} onSave={v => run(() => api.post('/sla-policies', body(v)), 'Objectif créé')} onDelete={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)} className="px-3 py-2 rounded-lg text-xs font-semibold border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Plus size={13} /> Nouvel objectif SLA</button>}
    </div>
  );
}
