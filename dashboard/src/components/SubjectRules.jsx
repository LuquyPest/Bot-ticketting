import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const PRIORITY = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };
const sel = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-2 text-xs focus:outline-hidden focus:border-primary/50';

// Automatic rules by subject: applied when a ticket opens (tag, priority, grade restriction)
export default function SubjectRules({ subjects = [] }) {
  const [rules, setRules] = useState([]);
  const [tags, setTags] = useState([]);
  const [grades, setGrades] = useState([]);
  const [form, setForm] = useState({ matchType: 'subject', subject: '', keywords: '', tagId: '', priority: '', gradeId: '' });
  const load = useCallback(() => { api.get('/subject-rules').then(r => setRules(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    load();
    api.get('/tags').then(r => setTags(r.data)).catch(() => {});
    api.get('/grades').then(r => setGrades(r.data)).catch(() => {});
  }, [load]);

  const add = async () => {
    try {
      await api.post('/subject-rules', { matchType: form.matchType, subject: form.subject, keywords: form.keywords, tagId: form.tagId || null, priority: form.priority || null, gradeId: form.gradeId || null });
      setForm(f => ({ ...f, subject: '', keywords: '', tagId: '', priority: '', gradeId: '' }));
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const remove = async (r) => {
    try { await api.delete(`/subject-rules/${r.id}`); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3 flex items-center gap-1.5"><Zap size={12} /> Règles automatiques à l'ouverture d'un ticket : selon son <strong className="font-semibold">sujet</strong> (« paiement » couvre « Problème de paiement »), ou selon des <strong className="font-semibold">mots-clés</strong> du premier message (« rembours » couvre « remboursement »). Accents et majuscules ignorés.</p>
      {rules.length > 0 && (
        <ul className="space-y-1.5">
          {rules.map(r => (
            <li key={r.id} className="flex items-center gap-2 text-xs bg-surface rounded-lg border border-overlay/6 px-3 py-2">
              <span className="font-semibold text-ink-1">{r.match_type === 'keyword' ? <>Message contenant <span className="text-primary-light">{r.keywords}</span></> : <>Sujet « {r.subject} »</>}</span>
              <span className="text-ink-3 flex-1">
                → {[r.tag_name && `tag ${r.tag_name}`, r.priority && `priorité ${PRIORITY[r.priority].toLowerCase()}`, r.grade_name && `réservé au grade ${r.grade_name}`].filter(Boolean).join(', ')}
              </span>
              <button onClick={() => remove(r)} aria-label={`Supprimer la règle ${r.subject || r.keywords}`} className="text-ink-4 hover:text-red-400"><Trash2 size={12} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex rounded-lg bg-overlay/4 p-0.5 w-fit" role="group" aria-label="Déclencheur de la règle">
        {[['subject', 'Par sujet'], ['keyword', 'Par mots-clés']].map(([v, l]) => (
          <button key={v} type="button" onClick={() => setForm(f => ({ ...f, matchType: v }))} aria-pressed={form.matchType === v}
            className={`px-3 py-1 rounded-md text-[11px] font-medium ${form.matchType === v ? 'bg-surface-elevated text-ink-1 shadow-card' : 'text-ink-3 hover:text-ink-1'}`}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {form.matchType === 'keyword'
          ? <input value={form.keywords} onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))} maxLength={300} placeholder="remboursement, carte refusée" aria-label="Mots-clés séparés par des virgules" className={`${sel} col-span-2 md:col-span-1`} />
          : <input list="rule-subjects" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} maxLength={100} placeholder="Sujet" aria-label="Sujet" className={`${sel} col-span-2 md:col-span-1`} />}
        <datalist id="rule-subjects">{subjects.map(s => <option key={s} value={s} />)}</datalist>
        <select value={form.tagId} onChange={e => setForm(f => ({ ...f, tagId: e.target.value }))} aria-label="Tag" className={sel}>
          <option value="">Pas de tag</option>{tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} aria-label="Priorité" className={sel}>
          <option value="">Priorité inchangée</option>{Object.entries(PRIORITY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={form.gradeId} onChange={e => setForm(f => ({ ...f, gradeId: e.target.value }))} aria-label="Grade" className={sel}>
          <option value="">Visible par tout le staff</option>{grades.map(g => <option key={g.id} value={g.id}>Réservé : {g.name}</option>)}
        </select>
        <button onClick={add} disabled={!(form.matchType === 'keyword' ? form.keywords : form.subject).trim()} className="flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-white bg-primary hover:bg-primary-light disabled:opacity-50 py-2">
          <Plus size={12} /> Ajouter
        </button>
      </div>
    </div>
  );
}
