import React, { useState } from 'react';
import { Eye, EyeOff, Copy, KeyRound } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Key of the encrypted backups (BACKUP_KEY), shown on demand to the owner of the instance only:
// the backups hold every server of the instance. Each display is written to the instance log.
export default function BackupKey() {
  const [key, setKey] = useState(null);
  const [busy, setBusy] = useState(false);

  const reveal = async () => {
    if (key) { setKey(null); return; }
    setBusy(true);
    try {
      const { data } = await api.get('/instance/backup-key');
      if (!data.configured) toast.error('Aucune clé : BACKUP_KEY n\'est pas défini dans .env');
      else setKey(data.key);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(key); toast.success('Clé copiée'); }
    catch { toast.error('Copie impossible — sélectionne la clé à la main'); }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <KeyRound size={14} className="text-ink-3 shrink-0" />
        <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-lg bg-surface border border-overlay/8 text-xs text-ink-1 font-mono select-all">
          {key || '•'.repeat(32)}
        </code>
        <button type="button" onClick={reveal} disabled={busy} aria-label={key ? 'Masquer la clé' : 'Afficher la clé'}
          className="p-2 rounded-lg border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">
          {key ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        {key && (
          <button type="button" onClick={copy} aria-label="Copier la clé" className="p-2 rounded-lg border border-overlay/8 text-ink-2 hover:text-ink-1">
            <Copy size={14} />
          </button>
        )}
      </div>
      <p className="text-[11px] text-ink-3">Restauration : <code className="font-mono">scripts/restore.sh backups/ticketbot-&lt;date&gt;.sql.gz.enc</code></p>
    </div>
  );
}
