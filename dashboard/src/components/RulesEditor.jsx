import React, { useEffect, useState } from 'react';
import { Workflow, Loader2, Plus, Trash2, ArrowUp, ArrowDown, FlaskConical } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useStages } from '../hooks/useStages';

// Paramètres → Règles (v5.2): WHEN · IF · THEN, in order (utils/ruleEngine.js)
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const TRIGGERS = [['created', 'Un ticket est ouvert'], ['member_reply', 'Le demandeur écrit'], ['staff_reply', 'Le staff répond'], ['stage', 'Le statut change'], ['priority', 'La priorité change'], ['time', 'Le temps passe']];
const BASES = [['created', 'l\'ouverture'], ['stage', 'le dernier changement de statut'], ['last_member', 'le dernier message du demandeur'], ['last_staff', 'la dernière réponse du staff'],
  ['last_activity', 'la dernière activité'], ['tto_due', 'l\'échéance de prise en charge'], ['ttr_due', 'l\'échéance de résolution']];
const FIELDS = [['channel', 'Canal'], ['address', 'Adresse de réception'], ['type', 'Type'], ['subject', 'Sujet'], ['text', 'Mots dans le message'], ['requester', 'Demandeur'],
  ['priority', 'Priorité'], ['stage', 'Statut'], ['tag', 'Tag'], ['hours', 'Horaires'], ['language', 'Langue du demandeur'], ['organization', 'Organisation']];
const ACTIONS = [['priority', 'Priorité'], ['urgency', 'Urgence'], ['impact', 'Impact'], ['type', 'Type'], ['subject', 'Sujet'], ['team', 'Équipe'], ['assign', 'Attribuer à'],
  ['tagAdd', 'Ajouter le tag'], ['tagRemove', 'Retirer le tag'], ['stage', 'Statut'], ['grade', 'Restreindre au grade'], ['follower', 'Observateur'], ['notify', 'Prévenir'],
  ['reply', 'Réponse automatique'], ['note', 'Note interne'], ['webhook', 'Webhook'], ['close', 'Fermer le ticket']];
const CHOICES = {
  channel: [['discord', 'Discord'], ['email', 'E-mail'], ['web', 'Web']], type: [['incident', 'Incident'], ['request', 'Demande']],
  priority: [['low', 'Basse'], ['normal', 'Normale'], ['urgent', 'Urgente']], hours: [['open', 'Support ouvert'], ['closed', 'Support fermé']],
  language: [['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português']],
};
const FREE = { text: 'remboursement, carte refusée', requester: '@client.fr, Paul', address: 'support@exemple.fr' };

function Chips({ options, value, onChange, single = false, label }) {
  return (
    <span className="inline-flex flex-wrap gap-1" role="group" aria-label={label}>
      {options.map(([v, l]) => {
        const on = value.map(String).includes(String(v));
        return <button key={v} type="button" aria-pressed={on} onClick={() => onChange(single ? [v] : on ? value.filter(x => String(x) !== String(v)) : [...value, v])}
          className={`px-2 py-0.5 rounded-md text-[11px] border ${on ? 'bg-primary/15 text-primary-light border-primary/40' : 'border-overlay/8 text-ink-3 hover:text-ink-1'}`}>{l}</button>;
      })}
    </span>
  );
}

function ConditionRow({ c, ctx, onChange, onRemove }) {
  const opts = CHOICES[c.field] || (c.field === 'stage' ? ctx.stages.map(s => [s.key, s.label]) : c.field === 'tag' ? ctx.tags.map(t => [t.id, t.name]) : c.field === 'organization' ? (ctx.orgs || []).map(o => [o.id, o.name]) : c.field === 'subject' ? ctx.subjects.map(s => [s, s]) : null);
  return (
    <div className="flex flex-wrap items-center gap-2 bg-overlay/2.5 rounded-lg px-2 py-1.5">
      <select value={c.field} onChange={e => onChange({ field: e.target.value, not: false, values: [] })} aria-label="Champ de la condition" className={INPUT}>
        {FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select value={c.not ? 'not' : 'is'} onChange={e => onChange({ ...c, not: e.target.value === 'not' })} aria-label="Sens de la condition" className={INPUT}>
        <option value="is">{c.field === 'text' ? 'contient' : 'est'}</option><option value="not">{c.field === 'text' ? 'ne contient pas' : 'n\'est pas'}</option>
      </select>
      {opts ? <Chips options={opts} value={c.values} onChange={v => onChange({ ...c, values: v })} single={c.field === 'hours'} label="Valeurs" />
        : <input value={c.field === 'text' ? (c.values[0] || '') : c.values.join(', ')} placeholder={FREE[c.field]} aria-label="Valeurs (séparées par des virgules)"
          onChange={e => onChange({ ...c, values: c.field === 'text' ? [e.target.value] : e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} className={`${INPUT} flex-1 min-w-48`} />}
      <button type="button" onClick={onRemove} aria-label="Retirer la condition" className="ml-auto p-1 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>
    </div>
  );
}

function ActionRow({ a, ctx, onChange, onRemove }) {
  const set = value => onChange({ ...a, value });
  const sel = (options, label) => (
    <select value={a.value ?? ''} onChange={e => set(e.target.value)} aria-label={label} className={INPUT}>
      <option value="">—</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  let input = null;
  switch (a.type) {
    case 'priority': case 'type': input = sel(CHOICES[a.type], 'Valeur'); break;
    case 'urgency': case 'impact': input = sel([1, 2, 3, 4, 5].map(n => [n, String(n)]), 'Niveau'); break;
    case 'subject': input = sel(ctx.subjects.map(s => [s, s]), 'Sujet'); break;
    case 'team': input = sel(ctx.teams.map(t => [t.id, t.name]), 'Équipe'); break;
    case 'assign': input = sel(ctx.staff.map(s => [s.user_id, s.username]), 'Personne'); break;
    case 'tagAdd': case 'tagRemove': input = sel(ctx.tags.map(t => [t.id, t.name]), 'Tag'); break;
    case 'stage': input = sel(ctx.stages.map(s => [s.key, s.label]), 'Statut'); break;
    case 'grade': input = sel(ctx.grades.map(g => [g.id, g.name]), 'Grade'); break;
    case 'follower': case 'notify': input = <Chips options={ctx.staff.map(s => [s.user_id, s.username])} value={Array.isArray(a.value) ? a.value : []} onChange={set} label="Personnes" />; break;
    case 'reply': case 'note': input = <textarea value={a.value || ''} onChange={e => set(e.target.value)} maxLength={2000} rows={2} aria-label="Texte" placeholder={a.type === 'reply' ? 'Bonjour, nous avons bien reçu ta demande…' : 'À traiter avant midi'} className={`${INPUT} flex-1 min-w-60`} />; break;
    default: input = null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 bg-overlay/2.5 rounded-lg px-2 py-1.5">
      <select value={a.type} onChange={e => onChange({ type: e.target.value, value: ['webhook', 'close'].includes(e.target.value) ? true : ['follower', 'notify'].includes(e.target.value) ? [] : '' })} aria-label="Action" className={INPUT}>
        {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {input}
      <button type="button" onClick={onRemove} aria-label="Retirer l'action" className="ml-auto p-1 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>
    </div>
  );
}

const TIMER = { basis: 'last_staff', minutes: 2880, direction: 'after', businessHours: true };
function TimerFields({ timer, onChange }) {
  const set = (k, v) => onChange({ ...timer, [k]: v });
  const due = ['tto_due', 'ttr_due'].includes(timer.basis);
  const h = Math.floor(timer.minutes / 60), m = timer.minutes % 60;
  const setDur = (hh, mm) => set('minutes', Math.max(1, (parseInt(hh) || 0) * 60 + (parseInt(mm) || 0)));
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2 bg-overlay/2.5 rounded-lg px-2 py-1.5">
      <input type="number" min={0} max={8760} value={h} onChange={e => setDur(e.target.value, m)} aria-label="Délai : heures" className={`${INPUT} w-16`} /> h
      <input type="number" min={0} max={59} value={m} onChange={e => setDur(h, e.target.value)} aria-label="Délai : minutes" className={`${INPUT} w-14`} /> min
      <select value={due ? timer.direction : 'after'} onChange={e => set('direction', e.target.value)} disabled={!due} aria-label="Avant ou après" className={INPUT}>
        <option value="after">après</option><option value="before">avant</option>
      </select>
      <select value={timer.basis} onChange={e => onChange({ ...timer, basis: e.target.value, direction: ['tto_due', 'ttr_due'].includes(e.target.value) ? timer.direction : 'after' })} aria-label="Point de départ" className={INPUT}>
        {BASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <label className="inline-flex items-center gap-1"><input type="checkbox" checked={timer.businessHours} onChange={e => set('businessHours', e.target.checked)} className="accent-primary" />en heures ouvrées</label>
      <span className="w-full text-[11px] text-ink-4">Vérifié toutes les 5 minutes ; une fois par ticket, puis à nouveau si le point de départ change (nouvelle réponse, nouveau statut).</span>
    </div>
  );
}

// Numbers stay numbers for the server (ids, levels)
const NUMERIC = ['urgency', 'impact', 'team', 'tagAdd', 'tagRemove', 'grade'];
const bodyOf = r => ({
  name: r.name, triggers: r.triggers, match: r.match, stop: r.stop, active: r.active, conditions: r.conditions, timer: r.triggers.includes('time') ? r.timer : null,
  actions: r.actions.map(a => (NUMERIC.includes(a.type) && a.value !== '' ? { ...a, value: Number(a.value) } : a)),
});

function RuleForm({ initial, ctx, busy, onSave, onDelete, onMove }) {
  const [r, setR] = useState(initial);
  const [ticketId, setTicketId] = useState('');
  const [test, setTest] = useState(null);
  const set = (k, v) => setR(x => ({ ...x, [k]: v }));
  const runTest = async () => {
    try { setTest((await api.post('/rules/test', { ticketId: Number(ticketId), rule: bodyOf(r) })).data); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={r.name} onChange={e => set('name', e.target.value)} maxLength={80} placeholder="Clients VIP" aria-label="Nom de la règle" className={`${INPUT} flex-1 min-w-48`} />
        <label className="flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" checked={r.active} onChange={e => set('active', e.target.checked)} className="accent-primary" />Active</label>
        {onMove && <><button type="button" onClick={() => onMove(-1)} aria-label="Monter" className="p-1 text-ink-3 hover:text-ink-1"><ArrowUp size={12} /></button><button type="button" onClick={() => onMove(1)} aria-label="Descendre" className="p-1 text-ink-3 hover:text-ink-1"><ArrowDown size={12} /></button></>}
      </div>
      <div className="space-y-1"><p className="text-[11px] font-semibold text-ink-3">Quand</p>
        {/* « Le temps passe » is a trigger of its own */}
        <Chips options={TRIGGERS} value={r.triggers} label="Déclencheurs"
          onChange={v => set('triggers', v.includes('time') && !r.triggers.includes('time') ? ['time'] : v.filter(x => x !== 'time' || v.length === 1))} />
        {r.triggers.includes('time') && <TimerFields timer={r.timer || TIMER} onChange={v => set('timer', v)} />}
      </div>
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-ink-3 flex items-center gap-2">Si
          <select value={r.match} onChange={e => set('match', e.target.value)} aria-label="Toutes ou au moins une condition" className={`${INPUT} font-normal`}>
            <option value="all">toutes les conditions</option><option value="any">au moins une condition</option>
          </select>
          {!r.conditions.length && <span className="font-normal text-ink-4">(sans condition : tous les tickets)</span>}
        </p>
        {r.conditions.map((c, i) => <ConditionRow key={i} c={c} ctx={ctx} onChange={v => set('conditions', r.conditions.map((x, j) => (j === i ? v : x)))} onRemove={() => set('conditions', r.conditions.filter((_, j) => j !== i))} />)}
        {r.conditions.length < 20 && <button type="button" onClick={() => set('conditions', [...r.conditions, { field: 'channel', not: false, values: [] }])} className="text-[11px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><Plus size={11} /> Ajouter une condition</button>}
      </div>
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-ink-3">Alors</p>
        {r.actions.map((a, i) => <ActionRow key={i} a={a} ctx={ctx} onChange={v => set('actions', r.actions.map((x, j) => (j === i ? v : x)))} onRemove={() => set('actions', r.actions.filter((_, j) => j !== i))} />)}
        {r.actions.length < 20 && <button type="button" onClick={() => set('actions', [...r.actions, { type: 'priority', value: '' }])} className="text-[11px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><Plus size={11} /> Ajouter une action</button>}
      </div>
      <label className="flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" checked={r.stop} onChange={e => set('stop', e.target.checked)} className="accent-primary" />Arrêter après cette règle (les suivantes ne s'appliquent pas)</label>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onSave(bodyOf(r))} disabled={busy || !r.name.trim() || !r.triggers.length || !r.actions.length} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 size={12} className="animate-spin" />}{initial.id ? 'Enregistrer' : 'Créer la règle'}
        </button>
        {onDelete && <button onClick={onDelete} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs text-ink-3 hover:text-red-400 border border-overlay/8 inline-flex items-center gap-1.5"><Trash2 size={12} /> Supprimer</button>}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <input type="number" min={1} value={ticketId} onChange={e => setTicketId(e.target.value)} placeholder="N° de ticket" aria-label="Ticket sur lequel tester" className={`${INPUT} w-28`} />
          <button type="button" onClick={runTest} disabled={!ticketId} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5 disabled:opacity-50"><FlaskConical size={12} /> Tester</button>
        </span>
      </div>
      {test && (
        <div className="text-xs rounded-lg border border-overlay/8 p-2 space-y-1" role="status">
          <p className={test.matched ? 'text-emerald-300 font-semibold' : 'text-ink-3 font-semibold'}>{test.matched ? 'La règle s\'appliquerait :' : 'La règle ne s\'appliquerait pas.'}</p>
          {test.conditions.map((c, i) => <p key={i} className={c.ok ? 'text-emerald-300' : 'text-red-300'}>{`${c.ok ? '✓' : '✗'} ${FIELDS.find(f => f[0] === c.field)?.[1] || c.field}`}</p>)}
          {test.actions.map((a, i) => <p key={`a${i}`} className="text-ink-2">→ {a}</p>)}
        </div>
      )}
    </div>
  );
}

const NEW = { name: '', triggers: ['created'], match: 'all', conditions: [], actions: [{ type: 'priority', value: 'urgent' }], stop: false, active: true };

export default function RulesEditor() {
  const [list, setList] = useState(null);
  const [ctx, setCtx] = useState({ subjects: [], tags: [], teams: [], staff: [], grades: [], stages: [] });
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState(0);
  const { stages } = useStages();
  useEffect(() => {
    api.get('/rules').then(r => setList(r.data)).catch(() => setList(false));
    Promise.all([api.get('/teams/options'), api.get('/teams'), api.get('/tickets/staff'), api.get('/grades'), api.get('/organizations')].map(p => p.catch(() => ({ data: null }))))
      .then(([o, t, s, g, org]) => setCtx(c => ({ ...c, subjects: o.data?.subjects || [], tags: o.data?.tags || [], teams: t.data || [], staff: s.data || [], grades: Array.isArray(g.data) ? g.data : [], orgs: Array.isArray(org.data) ? org.data : [] })));
  }, []);
  const full = { ...ctx, stages: stages || [] };
  if (list === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (list === false) return <p className="text-xs text-ink-4">Réservé aux fondateurs et à la permission « Gérer les règles automatiques ».</p>;
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); setList(l => ({ ...l, ...r.data })); toast.success(ok); setAdding(false); setKey(k => k + 1); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const rules = list.rules || [];
  const move = (i, d) => { const ids = rules.map(r => r.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; run(() => api.put('/rules/order', { ids }), 'Ordre enregistré'); };
  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-ink-3 inline-flex items-start gap-2"><Workflow size={16} className="shrink-0 mt-0.5 text-primary-light" aria-hidden="true" />
        Quand quelque chose arrive à un ticket, si ses conditions sont remplies, la règle agit. Les règles passent dans l'ordre de la liste ; chacune est notée au journal du ticket. Une modification faite par une règle ne relance pas les règles ; 50 actions au plus par événement.
      </p>
      {list.simple > 0 && <p className="text-xs text-ink-4">{`Plus ${list.simple} règle(s) simple(s) par sujet ou mots-clés (Paramètres → Tickets), appliquées à l'ouverture avant celles-ci.`}</p>}
      {rules.map((r, i) => (
        <RuleForm key={`${r.id}-${key}`} initial={r} ctx={full} busy={busy} onMove={rules.length > 1 ? d => move(i, d) : null}
          onSave={b => run(() => api.put(`/rules/${r.id}`, b), 'Règle enregistrée')}
          onDelete={() => window.confirm(`Supprimer la règle « ${r.name} » ?`) && run(() => api.delete(`/rules/${r.id}`), 'Règle supprimée')} />
      ))}
      {adding ? <RuleForm key={`new-${key}`} initial={NEW} ctx={full} busy={busy} onSave={b => run(() => api.post('/rules', b), 'Règle créée')} onDelete={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)} className="px-3 py-2 rounded-lg text-xs font-semibold border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Plus size={13} /> Nouvelle règle</button>}
    </div>
  );
}
