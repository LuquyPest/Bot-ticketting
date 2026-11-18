import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Profil → Signature des e-mails (v5.0): my signature under my replies sent by e-mail in this
// space (never under an anonymous reply); then comes the space's signature
export default function EmailSignature() {
  const [sig, setSig] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/staff/me/signature').then(r => setSig(r.data.signature || '')).catch(() => setSig(false)); }, []);
  if (sig === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (sig === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const save = async () => {
    setBusy(true);
    try { setSig((await api.put('/staff/me/signature', { signature: sig })).data.signature); toast.success('Signature enregistrée'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <div className="space-y-2">
      <label className="block text-xs text-ink-3">Sous tes réponses envoyées par e-mail dans cet espace (gras, liens et listes comme dans un message)
        <textarea value={sig} onChange={e => setSig(e.target.value)} rows={3} maxLength={1000} placeholder={'Camille Martin\nSupport client — 01 23 45 67 89'}
          className="mt-1 w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary" />
      </label>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50">Enregistrer la signature</button>
        <span className="text-[11px] text-ink-4">Jamais sous une réponse anonyme. La signature de l'espace suit la tienne.</span>
      </div>
    </div>
  );
}
