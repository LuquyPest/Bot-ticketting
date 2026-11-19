import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Paramètres → Tickets → Rétention et archives (utils/ticketRetention.js, v5.7), founders
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';

export default function RetentionSettings() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/ticket-retention').then(r => setS(r.data)).catch(() => setS(false)); }, []);
  if (!s) return null;
  const set = (k, v) => setS(x => ({ ...x, [k]: v }));
  const save = async () => {
    if (s.mode === 'delete' && !window.confirm(`Les tickets clos depuis plus de ${s.months} mois seront supprimés définitivement chaque nuit, avec leurs messages et pièces jointes. Continuer ?`)) return;
    setBusy(true);
    try { setS((await api.put('/ticket-retention', { mode: s.mode, months: s.months, archiveMonths: s.archiveMonths })).data); toast.success('Rétention enregistrée'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-ink-2">
        <label htmlFor="ret-mode">Tickets clos depuis plus de</label>
        <input type="number" min={1} max={240} value={s.months} onChange={e => set('months', e.target.value)} aria-label="Durée de conservation en mois" className={`${INPUT} w-20`} />
        <span>mois :</span>
        <select id="ret-mode" value={s.mode} onChange={e => set('mode', e.target.value)} className={INPUT}>
          <option value="off">conservés</option>
          <option value="anonymize">anonymisés</option>
          <option value="delete">supprimés</option>
        </select>
      </div>
      <p className="text-ink-3">Anonymiser retire le demandeur, le sujet, les messages, les transcripts, les pièces jointes, les copies, les champs et les réponses à l'enquête ; les dates, statuts, types, équipes, personnes assignées, temps et coûts restent pour les statistiques. Appliqué chaque nuit.</p>
      {s.mode !== 'off' && <p className="text-amber-400" role="status">{`${s.due} ticket(s) concerné(s) aujourd'hui.`}</p>}
      <div className="flex flex-wrap items-center gap-2 text-ink-2">
        <span>Archiver les tickets clos depuis plus de</span>
        <input type="number" min={0} max={240} value={s.archiveMonths} onChange={e => set('archiveMonths', e.target.value)} aria-label="Archives après combien de mois" className={`${INPUT} w-20`} />
        <span>mois (0 : jamais)</span>
      </div>
      <p className="text-ink-3">Les archives sortent de la liste des tickets par défaut ; une recherche ou le filtre « Archives » les retrouve.</p>
      <button type="button" onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5">{busy && <Loader2 size={12} className="animate-spin" />} Enregistrer</button>
    </div>
  );
}
