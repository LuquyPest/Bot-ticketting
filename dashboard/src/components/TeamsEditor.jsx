import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, UsersRound } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { STAGE_CLS, STAGE_COLOR_NAMES } from '../hooks/useStages';
import EscalationLevels from './EscalationLevels';

const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const MODES = [['none', 'Aucune (file seulement)'], ['round_robin', 'Tour à tour'], ['load', 'Selon la charge']];
const EMPTY = { name: '', color: 'violet', assignMode: 'none', maxOpen: 0, subjects: [], tagIds: [], members: [], calendarId: null, olaMinutes: null, escalations: [] };

function Chips({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.length === 0 && <span className="text-[11px] text-ink-4">—</span>}
      {options.map(([v, name]) => {
        const on = value.includes(v);
        return (
          <button key={v} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter(x => x !== v) : [...value, v])}
            className={`px-2 py-0.5 rounded-md border text-[11px] ${on ? 'bg-primary/15 border-primary/40 text-ink-1' : 'border-overlay/8 text-ink-3 hover:text-ink-1'}`}>{name}</button>
        );
      })}
    </div>
  );
}

function TeamForm({ initial, staff, subjects, tags, calendars = [], teams = [], onSave, onDelete, busy }) {
  const [t, setT] = useState(initial);
  const set = (k, v) => setT(x => ({ ...x, [k]: v }));
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.5fr_0.8fr_1.2fr_0.6fr]">
        <input value={t.name} onChange={e => set('name', e.target.value)} maxLength={60} placeholder="Facturation" aria-label="Nom de l'équipe" className={INPUT} />
        <select value={t.color} onChange={e => set('color', e.target.value)} aria-label="Couleur de l'équipe" className={`${INPUT} ${(STAGE_CLS[t.color] || STAGE_CLS.slate).text}`}>
          {Object.entries(STAGE_COLOR_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        <select value={t.assignMode} onChange={e => set('assignMode', e.target.value)} aria-label="Attribution automatique" className={INPUT}>
          {MODES.map(([k, n]) => <option key={k} value={k}>Attribution : {n}</option>)}
        </select>
        <input type="number" min={0} max={500} value={t.maxOpen} onChange={e => set('maxOpen', Math.max(0, Math.min(500, parseInt(e.target.value) || 0)))}
          aria-label="Plafond de tickets ouverts par personne" title="Tickets ouverts au plus par personne avant de passer au suivant (0 = sans plafond)" className={INPUT} />
      </div>
      {calendars.length > 0 && (
        <label className="block text-[11px] font-semibold text-ink-3">Horaires de l'équipe
          <select value={t.calendarId || ''} onChange={e => set('calendarId', e.target.value ? Number(e.target.value) : null)} className={`${INPUT} mt-1 font-normal`}>
            <option value="">Ceux de l'espace</option>
            {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-ink-3">Membres</p>
        <Chips label="Membres" options={staff.map(s => [s.user_id, s.username])} value={t.members} onChange={v => set('members', v)} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-ink-3">Reçoit les tickets des sujets</p>
          <Chips label="Sujets" options={subjects.map(s => [s, s])} value={t.subjects} onChange={v => set('subjects', v)} />
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-ink-3">… ou portant les tags</p>
          <Chips label="Tags" options={tags.map(g => [g.id, g.name])} value={t.tagIds} onChange={v => set('tagIds', v)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-ink-3">Objectif interne (OLA)</p>
        <span className="inline-flex flex-wrap items-center gap-1 text-xs text-ink-3">Résoudre en
          <input type="number" min={0} max={8760} value={t.olaMinutes ? Math.floor(t.olaMinutes / 60) : ''} onChange={e => set('olaMinutes', ((parseInt(e.target.value) || 0) * 60 + (t.olaMinutes || 0) % 60) || null)} aria-label="Objectif interne : heures" className={`${INPUT} w-16!`} /> h
          <input type="number" min={0} max={59} value={t.olaMinutes ? t.olaMinutes % 60 : ''} onChange={e => set('olaMinutes', (Math.floor((t.olaMinutes || 0) / 60) * 60 + (parseInt(e.target.value) || 0)) || null)} aria-label="Objectif interne : minutes" className={`${INPUT} w-14!`} /> min
          après l'arrivée du ticket dans l'équipe, en heures ouvrées de ses horaires (vide = aucun)
        </span>
      </div>
      {t.olaMinutes > 0 && <EscalationLevels value={t.escalations || []} onChange={v => set('escalations', v)} objectives={['ola']} teams={teams} staff={staff} excludeTeamId={initial.id} />}
      <div className="flex gap-2">
        <button onClick={() => onSave(t)} disabled={busy || !t.name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 size={12} className="animate-spin" />}{initial.id ? 'Enregistrer' : 'Créer l\'équipe'}
        </button>
        {onDelete && (
          <button onClick={onDelete} disabled={busy} aria-label={`Supprimer l'équipe ${initial.name}`} className="px-2.5 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-3 hover:text-red-400 inline-flex items-center gap-1">
            <Trash2 size={12} aria-hidden="true" />Supprimer
          </button>
        )}
      </div>
    </div>
  );
}

// Équipe → Équipes (v4.2): teams of staff, the subjects and tags they receive, their automatic
// assignment (in turn, by load) and a cap of open tickets per person
export default function TeamsEditor() {
  const [teams, setTeams] = useState(null);
  const [ctx, setCtx] = useState({ staff: [], subjects: [], tags: [] });
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  useEffect(() => {
    api.get('/teams').then(r => setTeams(r.data)).catch(() => setTeams(false));
    Promise.all([api.get('/tickets/staff'), api.get('/teams/options'), api.get('/calendars').catch(() => ({ data: {} }))])
      .then(([s, o, c]) => setCtx({ staff: s.data || [], subjects: o.data?.subjects || [], tags: o.data?.tags || [], calendars: c.data?.calendars || [] }))
      .catch(() => {});
  }, []);
  if (teams === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (teams === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const run = async (fn, ok) => {
    setBusy(true);
    try { setTeams((await fn()).data); toast.success(ok); setKey(k => k + 1); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const body = t => ({ name: t.name, color: t.color, assignMode: t.assignMode, maxOpen: t.maxOpen, subjects: t.subjects, tagIds: t.tagIds, members: t.members, calendarId: t.calendarId || null, olaMinutes: t.olaMinutes || null, escalations: t.olaMinutes ? (t.escalations || []) : [] });
  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-ink-3 inline-flex items-start gap-2"><UsersRound size={16} className="shrink-0 mt-0.5 text-primary-light" aria-hidden="true" />
        Une équipe reçoit les nouveaux tickets de ses sujets ou de ses tags, et les voit dans sa file (Ma file → Mes équipes). Avec l'attribution automatique, chaque nouveau ticket va à un membre disponible, tour à tour ou à celui qui en a le moins ; les absents, les personnes en vacances, celles qui ne peuvent pas voir le ticket ou au plafond sont passés. Les tickets confidentiels ne sont jamais attribués.
      </p>
      {teams.map(t => (
        <TeamForm key={`${t.id}-${key}`} busy={busy} {...ctx} teams={teams}
          initial={{ id: t.id, name: t.name, color: t.color, assignMode: t.assignMode, maxOpen: t.maxOpen, subjects: t.subjects, tagIds: t.tagIds, members: t.members.map(m => m.userId), calendarId: t.calendarId || null, olaMinutes: t.olaMinutes || null, escalations: t.escalations || [] }}
          onSave={v => run(() => api.put(`/teams/${t.id}`, body(v)), 'Équipe enregistrée')}
          onDelete={() => window.confirm(`Supprimer l'équipe « ${t.name} » ? Ses tickets restent, sans équipe.`) && run(() => api.delete(`/teams/${t.id}`), 'Équipe supprimée')} />
      ))}
      <TeamForm key={`new-${key}`} busy={busy} {...ctx} teams={teams} initial={EMPTY} onSave={v => run(() => api.post('/teams', body(v)), 'Équipe créée')} />
    </div>
  );
}
