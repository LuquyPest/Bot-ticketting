import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Paramètres → Tickets → Enquête de satisfaction (v5.6, utils/surveys.js)
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';
export default function SurveySettings() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/surveys/settings').then(r => setS(r.data && Array.isArray(r.data.questions) ? r.data : false)).catch(() => setS(false)); }, []);
  if (s === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (!s) return null;
  const set = (k, v) => setS(x => ({ ...x, [k]: v }));
  const save = async () => { setBusy(true); try { setS((await api.put('/surveys/settings', s)).data); toast.success('Enquête enregistrée'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } setBusy(false); };
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-2">
        <label className="inline-flex items-center gap-1.5">Envoyer
          <select value={s.delayMinutes} onChange={e => set('delayMinutes', Number(e.target.value))} className={INPUT}>
            {[[0, 'à la fermeture'], [60, '1 h après'], [240, '4 h après'], [1440, '1 jour après'], [4320, '3 jours après'], [10080, '1 semaine après']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        <label className="inline-flex items-center gap-1.5">Enquête
          <select value={s.mode} onChange={e => set('mode', e.target.value)} className={INPUT}><option value="builtin">Celle de Datick</option><option value="external">Un lien vers mon outil</option></select></label>
      </div>
      {s.mode === 'external' ? (
        <input value={s.externalUrl} onChange={e => set('externalUrl', e.target.value)} placeholder="https://forms.example.com/satisfaction" aria-label="Adresse de l'enquête externe" className={`${INPUT} w-full`} />
      ) : (
        <div className="space-y-1.5">
          <p className="text-[11px] text-ink-4">La note sur 5 et un commentaire, plus jusqu'à 5 questions :</p>
          {s.questions.map((q, i) => (
            <div key={i} className="flex gap-1.5">
              <input value={q.label} onChange={e => set('questions', s.questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} maxLength={150} placeholder="Le délai vous a-t-il convenu ?" aria-label={`Question ${i + 1}`} className={`${INPUT} flex-1`} />
              <select value={q.type} onChange={e => set('questions', s.questions.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} aria-label={`Type de la question ${i + 1}`} className={INPUT}>
                <option value="rating">Note sur 5</option><option value="yesno">Oui / non</option><option value="text">Texte</option></select>
              <button type="button" onClick={() => set('questions', s.questions.filter((_, j) => j !== i))} aria-label={`Retirer la question ${i + 1}`} className="p-1 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>
            </div>
          ))}
          {s.questions.length < 5 && <button type="button" onClick={() => set('questions', [...s.questions, { label: '', type: 'rating' }])} className="text-[11px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><Plus size={11} /> Ajouter une question</button>}
        </div>
      )}
      <button type="button" onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Enregistrer l'enquête</button>
    </div>
  );
}
