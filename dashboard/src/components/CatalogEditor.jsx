import React, { useEffect, useState } from 'react';
import { LayoutGrid, Loader2, Plus, Trash2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Paramètres → Catalogue (v5.3, utils/catalog.js): the services the requester can ask for, their
// form (fields with display conditions) and what the ticket becomes
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const TYPES = [['text', 'Texte court'], ['textarea', 'Texte long'], ['number', 'Nombre'], ['select', 'Liste'], ['checkbox', 'Case à cocher'], ['date', 'Date']];

function FieldRow({ f, i, before, onChange, onRemove }) {
  const set = (k, v) => onChange({ ...f, [k]: v });
  const target = before.find(b => b.key === f.showIf?.key);
  return (
    <div className="bg-overlay/2.5 rounded-lg p-2 space-y-1.5" role="group" aria-label={`Champ ${i + 1}`}>
      <div className="grid gap-1.5 sm:grid-cols-[1.4fr_0.8fr_auto_auto]">
        <input value={f.label} onChange={e => set('label', e.target.value)} maxLength={100} placeholder="Modèle souhaité" aria-label="Libellé du champ" className={INPUT} />
        <select value={f.type} onChange={e => set('type', e.target.value)} aria-label="Type du champ" className={INPUT}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label className="inline-flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" checked={!!f.required} onChange={e => set('required', e.target.checked)} className="accent-primary" />Obligatoire</label>
        <button type="button" onClick={onRemove} aria-label="Retirer le champ" className="p-1 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>
      </div>
      {f.type === 'select' && <textarea value={(f.choices || []).join('\n')} onChange={e => set('choices', e.target.value.split('\n'))} rows={2} placeholder={'Portable\nÉcran'} aria-label="Choix (un par ligne)" className={INPUT} />}
      {before.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-4">Afficher seulement si
          <select value={f.showIf?.key || ''} onChange={e => set('showIf', e.target.value ? { key: e.target.value, equals: '' } : null)} aria-label="Champ de la condition" className={`${INPUT} w-auto!`}>
            <option value="">— toujours —</option>{before.map(b => <option key={b.key} value={b.key}>{b.label || b.key}</option>)}
          </select>
          {target && (target.type === 'select'
            ? <select value={f.showIf.equals} onChange={e => set('showIf', { ...f.showIf, equals: e.target.value })} aria-label="Valeur de la condition" className={`${INPUT} w-auto!`}><option value="">—</option>{(target.choices || []).filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}</select>
            : target.type === 'checkbox'
              ? <select value={f.showIf.equals} onChange={e => set('showIf', { ...f.showIf, equals: e.target.value })} aria-label="Valeur de la condition" className={`${INPUT} w-auto!`}><option value="oui">coché</option><option value="non">non coché</option></select>
              : <input value={f.showIf.equals} onChange={e => set('showIf', { ...f.showIf, equals: e.target.value })} aria-label="Valeur de la condition" placeholder="vaut…" className={`${INPUT} w-40!`} />)}
        </div>
      )}
    </div>
  );
}

function ServiceForm({ initial, ctx, busy, onSave, onDelete }) {
  const [s, setS] = useState(initial);
  const set = (k, v) => setS(x => ({ ...x, [k]: v }));
  const setT = (k, v) => setS(x => ({ ...x, template: { ...x.template, [k]: v } }));
  const setField = (i, v) => set('fields', s.fields.map((f, j) => (j === i ? v : f)));
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2.5">
      <div className="grid gap-2 sm:grid-cols-[4rem_1.5fr_1fr]">
        <input value={s.icon} onChange={e => set('icon', e.target.value)} maxLength={4} placeholder="💻" aria-label="Icône (emoji)" className={`${INPUT} text-center`} />
        <input value={s.name} onChange={e => set('name', e.target.value)} maxLength={80} placeholder="Demander du matériel" aria-label="Nom du service" className={INPUT} />
        <input value={s.category} onChange={e => set('category', e.target.value)} maxLength={60} placeholder="Matériel" aria-label="Catégorie du catalogue" className={INPUT} />
      </div>
      <input value={s.description} onChange={e => set('description', e.target.value)} maxLength={300} placeholder="Un poste, un écran, un casque…" aria-label="Description" className={INPUT} />
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-ink-3">Formulaire</p>
        {s.fields.map((f, i) => <FieldRow key={f.key} f={f} i={i} before={s.fields.slice(0, i)} onChange={v => setField(i, v)} onRemove={() => set('fields', s.fields.filter((_, j) => j !== i).map(x => (x.showIf?.key === f.key ? { ...x, showIf: null } : x)))} />)}
        {s.fields.length < 20 && <button type="button" onClick={() => set('fields', [...s.fields, { key: `f${Date.now().toString(36).slice(-6)}`, label: '', type: 'text', required: false, choices: [], showIf: null }])}
          className="text-[11px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><Plus size={11} /> Ajouter un champ</button>}
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-ink-3">Le ticket devient</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <select value={s.template.subject || ''} onChange={e => setT('subject', e.target.value || null)} aria-label="Sujet du ticket" className={INPUT}><option value="">Sujet : le nom du service</option>{ctx.subjects.map(x => <option key={x} value={x}>{`Sujet : ${x}`}</option>)}</select>
          <select value={s.template.type || ''} onChange={e => setT('type', e.target.value || null)} aria-label="Type du ticket" className={INPUT}><option value="">Type : selon le sujet</option><option value="incident">Type : incident</option><option value="request">Type : demande</option></select>
          <select value={s.template.priority || ''} onChange={e => setT('priority', e.target.value || null)} aria-label="Priorité du ticket" className={INPUT}><option value="">Priorité : normale</option><option value="low">Priorité : basse</option><option value="urgent">Priorité : urgente</option></select>
          <select value={s.template.teamId || ''} onChange={e => setT('teamId', e.target.value ? Number(e.target.value) : null)} aria-label="Équipe du ticket" className={INPUT}><option value="">Équipe : selon les règles</option>{ctx.teams.map(t => <option key={t.id} value={t.id}>{`Équipe : ${t.name}`}</option>)}</select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" checked={s.active} onChange={e => set('active', e.target.checked)} className="accent-primary" />Proposé</label>
        <button onClick={() => onSave({ ...s, fields: s.fields.map(f => ({ ...f, choices: (f.choices || []).map(c => c.trim()).filter(Boolean) })) })} disabled={busy || !s.name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 size={12} className="animate-spin" />}{initial.id ? 'Enregistrer' : 'Créer le service'}
        </button>
        {onDelete && <button onClick={onDelete} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs text-ink-3 hover:text-red-400 border border-overlay/8 inline-flex items-center gap-1.5"><Trash2 size={12} /> Supprimer</button>}
      </div>
    </div>
  );
}

const NEW = { name: '', icon: '', category: '', description: '', active: true, fields: [], template: { subject: null, type: null, priority: null, teamId: null } };

export default function CatalogEditor() {
  const [list, setList] = useState(null);
  const [ctx, setCtx] = useState({ subjects: [], teams: [] });
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState(0);
  useEffect(() => {
    api.get('/catalog').then(r => setList(r.data.services)).catch(() => setList(false));
    Promise.all([api.get('/teams/options'), api.get('/teams')].map(p => p.catch(() => ({ data: null })))).then(([o, t]) => setCtx({ subjects: o.data?.subjects || [], teams: t.data || [] }));
  }, []);
  if (list === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (list === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); setList(r.data.services); toast.success(ok); setAdding(false); setKey(k => k + 1); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-ink-3 inline-flex items-start gap-2"><LayoutGrid size={16} className="shrink-0 mt-0.5 text-primary-light" aria-hidden="true" />
        Ce que les demandeurs peuvent demander depuis l'espace membre, rangé par catégorie. Chaque service a son formulaire (un champ peut n'apparaître que selon une réponse précédente) et décide de ce que devient le ticket. Les formulaires d'ouverture d'avant ont été repris ici ; ils restent utilisés sur Discord.
      </p>
      {list.map(s => (
        <ServiceForm key={`${s.id}-${key}`} initial={s} ctx={ctx} busy={busy} onSave={b => run(() => api.put(`/catalog/${s.id}`, b), 'Service enregistré')}
          onDelete={() => window.confirm(`Supprimer le service « ${s.name} » ?`) && run(() => api.delete(`/catalog/${s.id}`), 'Service supprimé')} />
      ))}
      {adding ? <ServiceForm key={`new-${key}`} initial={NEW} ctx={ctx} busy={busy} onSave={b => run(() => api.post('/catalog', b), 'Service créé')} onDelete={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)} className="px-3 py-2 rounded-lg text-xs font-semibold border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Plus size={13} /> Nouveau service</button>}
    </div>
  );
}
