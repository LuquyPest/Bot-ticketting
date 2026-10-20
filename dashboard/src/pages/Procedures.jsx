import React, { useCallback, useEffect, useState } from 'react';
import { ListChecks, Plus, Trash2, ArrowUp, ArrowDown, Loader2, Pencil, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../utils/confirmToast';

const input = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:border-primary/50';
const EMPTY = { title: '', subject: '', steps: [{ text: '' }] };

// Checklists the staff follows on a ticket, by subject (or for every ticket)
export default function Procedures() {
  const [list, setList] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { api.get('/procedures').then(r => setList(r.data)).catch(() => setList([])); }, []);
  useEffect(() => {
    load();
    api.get('/config').then(r => setSubjects(r.data.ticketSubjects || [])).catch(() => {});
  }, [load]);

  const setStep = (i, text) => setForm(f => ({ ...f, steps: f.steps.map((s, k) => (k === i ? { ...s, text } : s)) }));
  const moveStep = (i, d) => setForm(f => {
    const steps = [...f.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return f;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...f, steps };
  });
  const removeStep = i => setForm(f => ({ ...f, steps: f.steps.filter((_, k) => k !== i) }));

  const save = async () => {
    setBusy(true);
    try {
      const body = { title: form.title, subject: form.subject || null, steps: form.steps.filter(s => s.text.trim()) };
      if (editing) await api.patch(`/procedures/${editing}`, body);
      else await api.post('/procedures', { ...body, position: list?.length || 0 });
      toast.success(editing ? 'Procédure modifiée' : 'Procédure créée');
      setForm(EMPTY); setEditing(null); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const edit = p => { setEditing(p.id); setForm({ title: p.title, subject: p.subject || '', steps: p.steps.map(s => ({ id: s.id, text: s.text })) }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const remove = async p => {
    if (!await confirmToast(`Supprimer la procédure « ${p.title} » (et les cases déjà cochées sur les tickets) ?`)) return;
    try { await api.delete(`/procedures/${p.id}`); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const toggle = async p => {
    try { await api.patch(`/procedures/${p.id}`, { active: !p.active }); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1">Procédures</h1>
        <p className="text-sm text-ink-3 mt-0.5">Des étapes à cocher dans la fiche selon le sujet du ticket, pour que chaque demande soit traitée de la même façon quel que soit l'agent. Fermer un ticket avec des étapes restantes demande une confirmation.</p>
      </div>

      <section className="bg-surface-card border border-overlay/6 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-2 flex-1">{editing ? 'Modifier la procédure' : 'Nouvelle procédure'}</h2>
          {editing && <button onClick={() => { setEditing(null); setForm(EMPTY); }} aria-label="Annuler la modification" className="p-1 text-ink-4 hover:text-ink-1"><X size={14} /></button>}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-ink-3">Titre</span>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} maxLength={100} placeholder="Vérification d'un paiement" className={`${input} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs text-ink-3">Sujet concerné</span>
            <input list="proc-subjects" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} maxLength={100} placeholder="Vide = tous les tickets" className={`${input} mt-1`} />
            <datalist id="proc-subjects">{subjects.map(s => <option key={s} value={s} />)}</datalist>
          </label>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-xs text-ink-3 mb-1">Étapes</legend>
          {form.steps.map((s, i) => (
            <div key={s.id || `new-${i}`} className="flex items-center gap-1.5">
              <span className="w-6 text-right text-xs text-ink-4 tabular-nums">{i + 1}.</span>
              <input value={s.text} onChange={e => setStep(i, e.target.value)} maxLength={200} placeholder="Demander la capture du paiement" aria-label={`Étape ${i + 1}`} className={input} />
              <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Monter l'étape" className="p-1.5 text-ink-4 hover:text-ink-1 disabled:opacity-30"><ArrowUp size={13} /></button>
              <button type="button" onClick={() => moveStep(i, 1)} disabled={i === form.steps.length - 1} aria-label="Descendre l'étape" className="p-1.5 text-ink-4 hover:text-ink-1 disabled:opacity-30"><ArrowDown size={13} /></button>
              <button type="button" onClick={() => removeStep(i)} disabled={form.steps.length === 1} aria-label="Retirer l'étape" className="p-1.5 text-ink-4 hover:text-red-400 disabled:opacity-30"><Trash2 size={13} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setForm(f => ({ ...f, steps: [...f.steps, { text: '' }] }))} disabled={form.steps.length >= 30}
            className="inline-flex items-center gap-1.5 text-xs text-primary-light hover:underline disabled:opacity-50 ml-7"><Plus size={12} /> Ajouter une étape</button>
        </fieldset>
        <button onClick={save} disabled={busy || !form.title.trim() || !form.steps.some(s => s.text.trim())}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ListChecks size={14} />} {editing ? 'Enregistrer' : 'Créer la procédure'}
        </button>
      </section>

      <section className="space-y-2">
        {!list && <div className="h-16 rounded-2xl bg-overlay/2.5 animate-pulse" />}
        {list && !list.length && <p className="text-sm text-ink-4">Aucune procédure pour l'instant.</p>}
        {list?.map(p => (
          <article key={p.id} className={`bg-surface-card border border-overlay/6 rounded-2xl p-4 ${p.active ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <ListChecks size={14} className="text-primary-light" />
              <h3 className="text-sm font-semibold text-ink-1">{p.title}</h3>
              <span className="text-[11px] text-ink-4">{p.subject ? `sujet « ${p.subject} »` : 'tous les tickets'} · {p.steps.length} étape(s){p.active ? '' : ' · désactivée'}</span>
              <div className="ml-auto flex gap-1">
                <button onClick={() => toggle(p)} className="px-2 py-1 rounded-lg text-[11px] text-ink-3 hover:text-ink-1 hover:bg-overlay/5">{p.active ? 'Désactiver' : 'Activer'}</button>
                <button onClick={() => edit(p)} aria-label={`Modifier ${p.title}`} className="p-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/5"><Pencil size={13} /></button>
                <button onClick={() => remove(p)} aria-label={`Supprimer ${p.title}`} className="p-1.5 rounded-lg text-ink-3 hover:text-red-400 hover:bg-red-400/10"><Trash2 size={13} /></button>
              </div>
            </div>
            <ol className="mt-2 ml-6 list-decimal text-xs text-ink-2 space-y-0.5">
              {p.steps.map(s => <li key={s.id}>{s.text}</li>)}
            </ol>
          </article>
        ))}
      </section>
    </div>
  );
}
