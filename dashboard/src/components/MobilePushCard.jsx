import React, { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Instance → Santé → Application mobile (v7, utils/mobilePush.js): Firebase service account
export default function MobilePushCard() {
  const [s, setS] = useState(null);
  const [json, setJson] = useState('');
  useEffect(() => { api.get('/instance/mobile-push').then(r => setS(r.data)).catch(() => setS(false)); }, []);
  if (!s) return null;
  const save = async v => { try { setS((await api.put('/instance/mobile-push', { serviceAccount: v })).data); setJson(''); toast.success(v ? 'Compte de service enregistré' : 'Notifications mobiles coupées'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <section className="bg-surface-card border border-overlay/6 rounded-2xl p-5 space-y-2.5">
      <h2 className="text-sm font-semibold text-ink-1 inline-flex items-center gap-2"><Smartphone size={15} aria-hidden="true" />Application mobile</h2>
      <p className="text-xs text-ink-3">L'application Android et iOS ouvre l'instance choisie. Pour ses notifications, colle le compte de service d'un projet Firebase (Paramètres du projet → Comptes de service → Générer une clé privée) ; la même configuration Firebase sert à construire l'application.</p>
      {s.configured
        ? <p className="text-xs text-ink-2">{`Projet ${s.projectId} · ${s.clientEmail}`} <button type="button" onClick={() => save(null)} className="ml-2 underline text-ink-3 hover:text-red-400">Retirer</button></p>
        : <p className="text-xs text-ink-4">Pas de notifications mobiles pour l'instant.</p>}
      <textarea value={json} onChange={e => setJson(e.target.value)} rows={3} placeholder='{ "type": "service_account", "project_id": "…", … }' aria-label="Compte de service Firebase (JSON)"
        className="w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-hidden focus:border-primary" />
      <button type="button" disabled={!json.trim()} onClick={() => save(json)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Enregistrer</button>
    </section>
  );
}
