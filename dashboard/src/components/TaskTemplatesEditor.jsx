import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Paramètres → Catalogue → Modèles de tâches (v5.4): a set of tasks applied at once
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';

function Form({ initial, busy, onSave, onDelete }) {
  const [t, setT] = useState(initial);
  const setTask = (i, k, v) => setT(x => ({ ...x, tasks: x.tasks.map((y, j) => (j === i ? { ...y, [k]: v } : y)) }));
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2">
      <input value={t.name} onChange={e => setT(x => ({ ...x, name: e.target.value }))} maxLength={80} placeholder="Arrivée d'un salarié" aria-label="Nom du modèle" className={INPUT} />
      {t.tasks.map((k, i) => (
        <div key={i} className="grid gap-1.5 sm:grid-cols-[1.6fr_0.6fr_0.6fr_auto_auto] items-center" role="group" aria-label={`Tâche ${i + 1}`}>
          <input value={k.title} onChange={e => setTask(i, 'title', e.target.value)} maxLength={200} placeholder="Préparer le poste" aria-label="Intitulé" className={INPUT} />
          <input type="number" min={1} value={k.plannedMinutes || ''} onChange={e => setTask(i, 'plannedMinutes', e.target.value ? Number(e.target.value) : null)} placeholder="min" aria-label="Durée prévue (minutes)" className={INPUT} />
          <input type="number" min={0} max={365} value={k.dueInDays ?? ''} onChange={e => setTask(i, 'dueInDays', e.target.value === '' ? null : Number(e.target.value))} placeholder="J+" aria-label="Échéance (jours après)" className={INPUT} />
          <label className="inline-flex items-center gap-1 text-[11px] text-ink-2"><input type="checkbox" checked={!!k.visible} onChange={e => setTask(i, 'visible', e.target.checked)} className="accent-primary" />Visible</label>
          <button type="button" onClick={() => setT(x => ({ ...x, tasks: x.tasks.filter((_, j) => j !== i) }))} aria-label="Retirer la tâche" className="p-1 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>
        </div>
      ))}
      <button type="button" onClick={() => setT(x => ({ ...x, tasks: [...x.tasks, { title: '', plannedMinutes: null, dueInDays: null, visible: false }] }))} className="text-[11px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><Plus size={11} /> Ajouter une tâche</button>
      <div className="flex gap-2">
        <button onClick={() => onSave(t)} disabled={busy || !t.name.trim() || !t.tasks.length} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5">{busy && <Loader2 size={12} className="animate-spin" />}{initial.id ? 'Enregistrer' : 'Créer le modèle'}</button>
        {onDelete && <button onClick={onDelete} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs text-ink-3 hover:text-red-400 border border-overlay/8 inline-flex items-center gap-1.5"><Trash2 size={12} /> Supprimer</button>}
      </div>
    </div>
  );
}

export default function TaskTemplatesEditor() {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState(0);
  useEffect(() => { api.get('/task-templates').then(r => setList(r.data.templates)).catch(() => setList(false)); }, []);
  if (list === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (list === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const run = async (fn, ok) => {
    setBusy(true);
    try { setList((await fn()).data.templates); toast.success(ok); setAdding(false); setKey(k => k + 1); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <div className="space-y-3 max-w-4xl">
      <p className="text-sm text-ink-3">Un ensemble de tâches ajoutées d'un coup à un ticket, depuis sa fiche ou par une règle (action « modèle de tâches »). « J+ » : l'échéance, en jours après l'application.</p>
      {list.map(t => <Form key={`${t.id}-${key}`} initial={t} busy={busy} onSave={b => run(() => api.put(`/task-templates/${t.id}`, b), 'Modèle enregistré')} onDelete={() => window.confirm(`Supprimer le modèle « ${t.name} » ?`) && run(() => api.delete(`/task-templates/${t.id}`), 'Modèle supprimé')} />)}
      {adding ? <Form key={`new-${key}`} initial={{ name: '', tasks: [{ title: '', plannedMinutes: null, dueInDays: null, visible: false }] }} busy={busy} onSave={b => run(() => api.post('/task-templates', b), 'Modèle créé')} onDelete={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)} className="px-3 py-2 rounded-lg text-xs font-semibold border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Plus size={13} /> Nouveau modèle de tâches</button>}
    </div>
  );
}
