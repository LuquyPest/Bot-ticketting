import React, { useEffect, useState } from 'react';
import { BadgeCheck, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import api from '../api';

// /validation#<token>: someone outside the team gives or refuses their agreement on a ticket
// (utils/approvals.js). The token stays in the fragment: never sent in a URL to the server.
export default function Approval() {
  const token = window.location.hash.slice(1);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!token) { setError('Lien incomplet'); return; }
    api.post('/approvals/link', { token }).then(r => setInfo(r.data)).catch(err => setError(err.response?.data?.error || 'Lien introuvable'));
  }, [token]);

  const answer = async decision => {
    setBusy(true); setError('');
    try {
      await api.post('/approvals/decide', { token, decision, comment });
      setDone(decision);
      // The link is spent: it leaves the address bar
      window.history.replaceState(null, '', '/validation');
    } catch (err) { setError(err.response?.data?.error || 'Erreur, réessaie.'); }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <main className="w-full max-w-md bg-surface-card border border-overlay/8 rounded-2xl p-6 space-y-4">
        <h1 className="text-lg font-bold text-ink-1 inline-flex items-center gap-2"><BadgeCheck size={18} aria-hidden="true" />Validation demandée</h1>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        {done ? (
          <p role="status" className={`text-sm inline-flex items-center gap-2 ${done === 'approved' ? 'text-emerald-400' : 'text-ink-2'}`}>
            {done === 'approved' ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
            {done === 'approved' ? 'Merci, ton accord a été transmis à l\'équipe.' : 'Merci, ton refus a été transmis à l\'équipe.'}
          </p>
        ) : info ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">{`${info.by} (${info.space}) demande ton accord sur le ticket #${info.ticketId}${info.subject ? ` — ${info.subject}` : ''}.`}</p>
            <blockquote className="text-sm text-ink-1 bg-overlay/4 rounded-xl px-3 py-2.5 whitespace-pre-wrap">{info.reason}</blockquote>
            <label className="block text-xs text-ink-3">Commentaire (facultatif)
              <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} rows={3}
                className="mt-1 w-full bg-surface border border-overlay/8 text-ink-1 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:border-primary/50" />
            </label>
            <div className="flex gap-2">
              <button onClick={() => answer('approved')} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" />}Donner mon accord
              </button>
              <button onClick={() => answer('rejected')} disabled={busy} className="flex-1 py-2.5 rounded-xl border border-overlay/10 text-ink-1 text-sm font-semibold hover:bg-overlay/5 disabled:opacity-50">Refuser</button>
            </div>
            <p className="text-xs text-ink-4">Une seule réponse est possible. Ce lien ne donne accès à rien d'autre.</p>
          </div>
        ) : !error && <Loader2 size={18} className="animate-spin text-ink-4" />}
      </main>
    </div>
  );
}
