import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Paramètres → Sauvegarde → Sauvegarde complète de l'espace (v8, utils/spaceBackup.js): every table
// and stored file of the space, encrypted with a passphrase chosen here, downloaded at once.
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const MIN = 12;

export default function SpaceBackupCard() {
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = pass.length >= MIN && pass === again;
  const download = async () => {
    setBusy(true);
    try {
      const r = await api.post('/space-backup/export', { passphrase: pass }, { responseType: 'blob', timeout: 0 });
      const name = /filename="([^"]+)"/.exec(r.headers['content-disposition'] || '')?.[1] || 'datick-espace.datick';
      const url = URL.createObjectURL(r.data);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setPass(''); setAgain('');
      toast.success('Sauvegarde téléchargée');
    } catch (err) {
      let msg = 'Erreur';
      try { msg = JSON.parse(await err.response?.data?.text?.())?.error || msg; } catch { /* not JSON */ }
      toast.error(msg);
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-ink-3">Toutes les données de l'espace — tickets, messages, contacts, réglages, base de connaissances, parc… — et ses fichiers, dans une archive chiffrée par la phrase de passe choisie ici. Elle sert aussi d'export complet : son format est décrit dans la documentation et se lit sans Datick. Rien n'est gardé sur le serveur ; sans la phrase de passe, l'archive est illisible.</p>
      <div className="grid gap-2 sm:grid-cols-2 max-w-xl">
        <input type="password" autoComplete="new-password" value={pass} onChange={e => setPass(e.target.value)} placeholder={`Phrase de passe (${MIN} caractères au moins)`} aria-label="Phrase de passe de la sauvegarde" className={INPUT} />
        <input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} placeholder="La même, encore une fois" aria-label="Confirmer la phrase de passe" className={INPUT} />
      </div>
      {again && pass !== again && <p className="text-[11px] text-red-400">Les deux phrases de passe diffèrent.</p>}
      <button type="button" onClick={download} disabled={!ok || busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white inline-flex items-center gap-1.5 disabled:opacity-50">
        {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Download size={12} aria-hidden="true" />}Télécharger la sauvegarde
      </button>
      <p className="text-[11px] text-ink-4">La restauration se fait dans Instance → Serveurs (propriétaire de l'instance), sur cet espace ou un autre.</p>
    </div>
  );
}
