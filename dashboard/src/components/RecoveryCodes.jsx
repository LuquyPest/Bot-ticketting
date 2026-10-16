import React from 'react';
import { Copy, Download, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';

// One-time display of 2FA recovery codes (the server only keeps their hashes).
export default function RecoveryCodes({ codes, onDone }) {
  const text = codes.join('\n');

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success('Codes copiés'); }
    catch { toast.error('Copie impossible — sélectionne les codes à la main'); }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([`Codes de secours 2FA — Ticket Bot\n\n${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codes-secours-2fa.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
        <KeyRound size={14} /> Codes de secours
      </div>
      <p className="text-xs text-ink-3">
        Garde-les en lieu sûr : chacun permet <strong>une</strong> connexion si tu perds ton téléphone.
        Ils ne seront plus jamais affichés.
      </p>
      <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-black/20 border border-white/6 p-3 font-mono text-xs text-ink-1 select-all">
        {codes.map(c => <span key={c}>{c}</span>)}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={copy}
          className="flex-1 py-2 rounded-xl text-xs text-ink-2 border border-white/8 hover:bg-white/5 transition-all flex items-center justify-center gap-1.5">
          <Copy size={12} /> Copier
        </button>
        <button type="button" onClick={download}
          className="flex-1 py-2 rounded-xl text-xs text-ink-2 border border-white/8 hover:bg-white/5 transition-all flex items-center justify-center gap-1.5">
          <Download size={12} /> Télécharger
        </button>
      </div>
      <button type="button" onClick={onDone}
        className="w-full py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary-light transition-all">
        J'ai sauvegardé mes codes
      </button>
    </div>
  );
}
