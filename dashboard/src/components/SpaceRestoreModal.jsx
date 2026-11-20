import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Instance → Serveurs → Restaurer (v8): a space backup (.datick) replaces every table of this space
export default function SpaceRestoreModal({ guild, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const input = 'w-full bg-surface border border-overlay/8 rounded-xl px-3 py-2 text-sm text-ink-1';
  const restore = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('passphrase', pass);
      fd.append('file', file);
      const { data } = await api.post(`/instance/guilds/${guild.guild_id}/restore`, fd, { timeout: 0 });
      setResult(data);
      toast.success('Espace restauré');
      onDone?.();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Restaurer une sauvegarde">
      <div className="w-full max-w-md bg-surface-card border border-overlay/8 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-1">Restaurer une sauvegarde — <span translate="no">{guild.guild_name}</span></h2>
          <button onClick={onClose} aria-label="Fermer" className="p-1 text-ink-3 hover:text-ink-1"><X size={14} /></button>
        </div>
        {result ? (
          <div className="space-y-2 text-sm text-ink-2">
            <p>{`${result.rows} ligne(s) dans ${result.tables} table(s) et ${result.files} fichier(s) restaurés.`}</p>
            {result.from?.createdAt && <p className="text-xs text-ink-4">{`Sauvegarde du ${new Date(result.from.createdAt).toLocaleString()}${result.from.name ? `, espace « ${result.from.name} »` : ''}${result.from.appVersion ? `, Datick ${result.from.appVersion}` : ''}.`}</p>}
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold">Fermer</button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-ink-3">Toutes les données de cet espace sont remplacées par celles de la sauvegarde, d'un coup (l'espace passe en maintenance le temps de l'opération). Venue d'un autre espace, elle en reprend aussi les réglages Discord, à revoir ensuite.</p>
            <input type="file" accept=".datick,application/octet-stream" onChange={e => setFile(e.target.files?.[0] || null)} aria-label="Fichier de sauvegarde" className="text-xs text-ink-2" />
            <input type="password" autoComplete="off" value={pass} onChange={e => setPass(e.target.value)} placeholder="Phrase de passe de la sauvegarde" aria-label="Phrase de passe de la sauvegarde" className={input} />
            <label className="block text-xs text-ink-3">Pour confirmer, recopie le nom de l'espace : <strong className="text-ink-2" translate="no">{guild.guild_name}</strong>
              <input value={confirm} onChange={e => setConfirm(e.target.value)} className={`${input} mt-1`} />
            </label>
            <button onClick={restore} disabled={busy || !file || !pass || confirm.trim() !== guild.guild_name} className="px-4 py-2 rounded-xl bg-red-600/15 text-red-300 border border-red-600/30 text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}Restaurer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
