import React, { useState } from 'react';
import { Plus, X, CornerDownRight } from 'lucide-react';

const SEP = ' › ';
const parentOf = s => (s.includes(SEP) ? s.split(SEP)[0] : null);
const leafOf = s => s.split(SEP).pop();
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary';

// Paramètres → Tickets → Sujets de ticket (v4.2): categories and their sub-categories
// (« Facturation › Remboursement »), each with an optional deadline that replaces the stage's
// (sub-categories inherit their category's). Saved with the page.
export default function SubjectTreeEditor({ subjects, sla, onChange }) {
  const [newRoot, setNewRoot] = useState('');
  const [newChild, setNewChild] = useState({});
  const roots = subjects.filter(s => !parentOf(s));
  const children = r => subjects.filter(s => parentOf(s) === r);
  const exists = s => subjects.some(x => x.toLowerCase() === s.toLowerCase());
  const add = s => { if (s && !exists(s) && !s.includes(SEP.trim())) onChange([...subjects, s], sla); };
  const addChild = r => {
    const name = (newChild[r] || '').trim();
    if (!name || name.includes(SEP.trim())) return;
    const path = `${r}${SEP}${name}`;
    if (exists(path)) return;
    // Kept right after its category and its other sub-categories
    const i = subjects.lastIndexOf(children(r).at(-1) || r);
    onChange([...subjects.slice(0, i + 1), path, ...subjects.slice(i + 1)], sla);
    setNewChild(x => ({ ...x, [r]: '' }));
  };
  const remove = s => {
    const gone = new Set([s, ...(parentOf(s) ? [] : children(s))]);
    if (gone.size > 1 && !window.confirm(`Retirer « ${s} » et ses ${gone.size - 1} sous-catégorie(s) ?`)) return;
    onChange(subjects.filter(x => !gone.has(x)), Object.fromEntries(Object.entries(sla || {}).filter(([k]) => !gone.has(k))));
  };
  const setSla = (s, v) => {
    const next = { ...(sla || {}) };
    if (v > 0) next[s] = v; else delete next[s];
    onChange(subjects, next);
  };
  const slaInput = (s, inherited) => (
    <input type="number" min={0} max={720} value={sla?.[s] || ''} onChange={e => setSla(s, Math.max(0, Math.min(720, parseInt(e.target.value) || 0)))}
      placeholder={inherited ? `${inherited} h (catégorie)` : 'Délai de l\'étape'} aria-label={`Délai de « ${s} » (heures)`} title="Délai en heures dans chaque étape qui en a un — vide : celui de l'étape (ou de la catégorie)"
      className={`${INPUT} w-36 text-xs`} />
  );
  const row = (s, child) => (
    <div key={s} className={`flex items-center gap-2 ${child ? 'pl-6' : ''}`}>
      {child && <CornerDownRight size={13} className="text-ink-4 shrink-0" aria-hidden="true" />}
      <span className="flex-1 bg-surface border border-overlay/8 rounded-lg px-3 py-2 text-sm text-ink-2" translate="no">{child ? leafOf(s) : s}</span>
      {slaInput(s, child ? sla?.[parentOf(s)] : null)}
      <button onClick={() => remove(s)} aria-label={`Retirer le sujet ${s}`} className="p-1.5 text-ink-4 hover:text-red-400 transition-colors"><X size={14} /></button>
    </div>
  );
  return (
    <div className="space-y-2">
      {roots.map(r => (
        <div key={r} className="space-y-1.5">
          {row(r, false)}
          {children(r).map(c => row(c, true))}
          <div className="flex gap-2 pl-6">
            <input type="text" value={newChild[r] || ''} onChange={e => setNewChild(x => ({ ...x, [r]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addChild(r)}
              maxLength={60} placeholder="Ajouter une sous-catégorie…" aria-label={`Nouvelle sous-catégorie de ${r}`} className={`${INPUT} flex-1 text-xs py-1.5`} />
            <button onClick={() => addChild(r)} aria-label={`Ajouter la sous-catégorie à ${r}`} className="px-2.5 rounded-lg bg-surface border border-overlay/8 text-ink-3 hover:text-ink-1"><Plus size={13} /></button>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <input type="text" value={newRoot} onChange={e => setNewRoot(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { add(newRoot.trim()); setNewRoot(''); } }}
          maxLength={60} placeholder="Ajouter une catégorie…" aria-label="Nouvelle catégorie" className={`${INPUT} flex-1`} />
        <button onClick={() => { add(newRoot.trim()); setNewRoot(''); }} aria-label="Ajouter la catégorie" className="px-3 py-2 rounded-lg bg-surface border border-overlay/8 text-ink-2 hover:text-ink-1"><Plus size={15} /></button>
      </div>
    </div>
  );
}
