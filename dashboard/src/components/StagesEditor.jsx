import React, { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useStages, setStagesCache, STAGE_CLS, STAGE_COLOR_NAMES } from '../hooks/useStages';

const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const KINDS = [['open', 'Ouvert'], ['waiting', 'En attente'], ['in_progress', 'En cours']];
const EMPTY = { label: '', color: 'violet', kind: 'in_progress', categoryId: '', slaHours: 0 };

// Paramètres → Tickets → Statuts (v4.2): custom statuses beyond Ouvert / En attente / En cours,
// each with its colour, the built-in stage it behaves like for the requester, its Discord
// category and its SLA. Saved on their own (founders).
export default function StagesEditor({ discord, categories = [] }) {
  const stages = useStages();
  const custom = stages.filter(s => !s.builtin);
  const [edits, setEdits] = useState({});
  const [add, setAdd] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); setStagesCache(r.data); toast.success(ok); return true; }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; }
    finally { setBusy(false); }
  };
  const rowOf = s => edits[s.id] || { label: s.label, color: s.color, kind: s.kind, categoryId: s.categoryId || '', slaHours: s.slaHours };
  const setRow = (s, k, v) => setEdits(e => ({ ...e, [s.id]: { ...rowOf(s), [k]: v } }));
  const move = (i, d) => {
    const ids = custom.map(s => s.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    run(() => api.put('/stages/order', { ids }), 'Ordre enregistré');
  };
  const fields = (r, on) => (
    <>
      <input value={r.label} onChange={e => on('label', e.target.value)} maxLength={40} placeholder="Attente fournisseur" aria-label="Nom du statut" className={INPUT} />
      <select value={r.color} onChange={e => on('color', e.target.value)} aria-label="Couleur" className={`${INPUT} ${(STAGE_CLS[r.color] || STAGE_CLS.slate).text}`}>
        {Object.entries(STAGE_COLOR_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
      </select>
      <select value={r.kind} onChange={e => on('kind', e.target.value)} aria-label="Vu par le demandeur comme" className={INPUT}>
        {KINDS.map(([k, n]) => <option key={k} value={k}>Pour le demandeur : {n}</option>)}
      </select>
      {discord && (
        <select value={r.categoryId || ''} onChange={e => on('categoryId', e.target.value)} aria-label="Catégorie Discord" className={INPUT}>
          <option value="">Catégorie Discord : aucune</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      <input type="number" min={0} max={720} value={r.slaHours ?? 0} onChange={e => on('slaHours', Math.max(0, Math.min(720, parseInt(e.target.value) || 0)))} aria-label="Délai (heures)" title="Délai en heures (0 = aucun)" className={INPUT} />
    </>
  );
  const grid = `grid grid-cols-1 gap-2 sm:grid-cols-2 items-center ${discord ? 'lg:grid-cols-[1.4fr_0.8fr_1.2fr_1.2fr_0.5fr_auto]' : 'lg:grid-cols-[1.4fr_0.8fr_1.2fr_0.5fr_auto]'}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {stages.map(s => <span key={s.key} className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${(STAGE_CLS[s.color] || STAGE_CLS.slate).badge}`}>{s.label}</span>)}
      </div>
      <p className="text-xs text-ink-4">Les trois statuts de base se règlent ci-dessus. Un statut ajouté apparaît partout (fiche ticket, Kanban, filtres, macros, délais) ; le demandeur, lui, voit le statut de base choisi. Supprimer un statut remet ses tickets dans ce statut de base.</p>
      {custom.map((s, i) => {
        const r = rowOf(s);
        return (
          <div key={s.id} className={grid}>
            {fields(r, (k, v) => setRow(s, k, v))}
            <div className="flex gap-1">
              <button onClick={() => run(() => api.put(`/stages/${s.id}`, r), 'Statut enregistré').then(ok => ok && setEdits(e => { const x = { ...e }; delete x[s.id]; return x; }))} disabled={busy}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Enregistrer</button>
              <button onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={`Monter ${s.label}`} className="p-1.5 rounded-lg border border-overlay/8 text-ink-3 hover:text-ink-1 disabled:opacity-30"><ArrowUp size={12} /></button>
              <button onClick={() => move(i, 1)} disabled={busy || i === custom.length - 1} aria-label={`Descendre ${s.label}`} className="p-1.5 rounded-lg border border-overlay/8 text-ink-3 hover:text-ink-1 disabled:opacity-30"><ArrowDown size={12} /></button>
              <button onClick={() => window.confirm(`Supprimer le statut « ${s.label} » ? Ses tickets reviennent en « ${KINDS.find(k => k[0] === s.kind)[1]} ».`) && run(() => api.delete(`/stages/${s.id}`), 'Statut supprimé')} disabled={busy}
                aria-label={`Supprimer ${s.label}`} className="p-1.5 rounded-lg border border-overlay/8 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>
            </div>
          </div>
        );
      })}
      <div className={grid}>
        {fields(add, (k, v) => setAdd(a => ({ ...a, [k]: v })))}
        <button onClick={async () => { if (await run(() => api.post('/stages', add), 'Statut ajouté')) setAdd(EMPTY); }} disabled={busy || !add.label.trim()}
          className="px-2.5 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1 disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} aria-hidden="true" />}Ajouter
        </button>
      </div>
    </div>
  );
}
