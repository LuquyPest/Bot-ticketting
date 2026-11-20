import React, { useEffect, useState } from 'react';
import { Download, FileCheck2, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Données membres → Registre des traitements (v8, utils/processingRegister.js): generated from what
// is turned on in the space; the founder completes who is responsible, then downloads it
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const LABELS = [['controller', 'Responsable du traitement (organisme)'], ['address', 'Adresse'], ['dpo', 'Délégué à la protection des données (facultatif)'], ['contact', 'Contact pour l\'exercice des droits']];

export default function ProcessingRegisterCard() {
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const load = () => api.get('/gdpr-register').then(r => { setD(r.data); setF(r.data.identity); }).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  if (d === null) return <Loader2 size={14} className="animate-spin text-ink-4" />;
  if (!d) return null;
  const save = async () => { try { await api.put('/gdpr-register', f); toast.success('Registre enregistré'); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const download = async kind => {
    try {
      const r = await api.get(`/gdpr-register/export.${kind}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = Object.assign(document.createElement('a'), { href: url, download: `registre-des-traitements.${kind}` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch { toast.error('Erreur'); }
  };
  return (
    <section className="bg-surface-card border border-overlay/6 rounded-2xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-ink-1 inline-flex items-center gap-2"><FileCheck2 size={15} aria-hidden="true" />Registre des traitements (RGPD)</h2>
      <p className="text-xs text-ink-3">Généré d'après ce que l'espace utilise vraiment — canaux, services branchés, durées de conservation — et tenu à jour à chaque téléchargement. Complète le responsable et le contact, puis télécharge-le. Il décrit ce que fait l'outil : à relire avec le reste des traitements de l'organisme.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {LABELS.map(([k, l]) => <label key={k} className="block text-[11px] text-ink-3">{l}<input value={f[k] || ''} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} maxLength={300} className={`${INPUT} mt-0.5`} /></label>)}
      </div>
      <label className="block text-[11px] text-ink-3">Notes ajoutées au registre<textarea value={f.notes || ''} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} rows={2} maxLength={4000} className={`${INPUT} mt-0.5`} /></label>
      <p className="text-[11px] text-ink-4">{`${d.activities} activité(s) de traitement, ${d.recipients} destinataire(s) ou service(s) tiers d'après les réglages de l'espace.`}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white">Enregistrer</button>
        <button type="button" onClick={() => download('pdf')} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1"><Download size={12} aria-hidden="true" />PDF</button>
        <button type="button" onClick={() => download('md')} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1"><Download size={12} aria-hidden="true" />Markdown</button>
      </div>
    </section>
  );
}
