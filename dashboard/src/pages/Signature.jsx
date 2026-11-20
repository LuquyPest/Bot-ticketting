import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, PenLine, XCircle } from 'lucide-react';
import api from '../api';

// /signature#<token> (v8, utils/signatures.js): someone reads a document (a change, a release, a
// delivery) and signs it by typing their name and ticking « je valide », or refuses it. The token
// stays in the fragment: never sent in a URL to the server.
export default function Signature() {
  const token = window.location.hash.slice(1);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => {
    if (!token) { setError('Lien incomplet'); return; }
    api.post('/signature/link', { token }).then(r => setInfo(r.data)).catch(err => setError(err.response?.data?.error || 'Lien introuvable'));
  }, [token]);
  const send = async accept => {
    setBusy(true); setError('');
    try {
      await api.post('/signature/answer', { token, accept, name, reason });
      setDone(accept ? 'signed' : 'declined');
      window.history.replaceState(null, '', '/signature'); // the link is spent
    } catch (err) { setError(err.response?.data?.error || 'Erreur, réessaie.'); }
    setBusy(false);
  };
  const input = 'mt-1 w-full bg-surface border border-overlay/8 text-ink-1 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:border-primary/50';
  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <main className="w-full max-w-2xl bg-surface-card border border-overlay/8 rounded-2xl p-6 space-y-4">
        <h1 className="text-lg font-bold text-ink-1 inline-flex items-center gap-2"><PenLine size={18} aria-hidden="true" />Signature demandée</h1>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        {done ? (
          <p role="status" className={`text-sm inline-flex items-center gap-2 ${done === 'signed' ? 'text-emerald-400' : 'text-ink-2'}`}>
            {done === 'signed' ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
            {done === 'signed' ? 'Merci, ta signature a été enregistrée et transmise à l\'équipe.' : 'Merci, ton refus a été transmis à l\'équipe.'}
          </p>
        ) : info ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">{`${info.requestedBy || 'L\'équipe'} (${info.space}) demande à ${info.signer} de signer :`}</p>
            <h2 className="text-base font-semibold text-ink-1">{info.title}</h2>
            <div className="text-sm text-ink-1 bg-overlay/4 rounded-xl px-3 py-2.5 whitespace-pre-wrap max-h-96 overflow-y-auto" tabIndex={0} aria-label="Document à signer">{info.document}</div>
            <p className="text-[11px] text-ink-4 break-all">{`Empreinte SHA-256 du document : ${info.hash}`}</p>
            {!refusing ? (
              <>
                <label className="block text-xs text-ink-3">Ton nom, tel que tu signes
                  <input value={name} onChange={e => setName(e.target.value)} maxLength={100} autoComplete="name" className={input} />
                </label>
                <label className="flex items-start gap-2 text-sm text-ink-1"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="accent-primary mt-1" />Je valide ce document, et je reconnais que ce nom tapé vaut ma signature.</label>
                <div className="flex gap-2">
                  <button onClick={() => send(true)} disabled={busy || !agree || name.trim().length < 2} className="flex-1 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
                    {busy && <Loader2 size={14} className="animate-spin" />}Signer
                  </button>
                  <button onClick={() => setRefusing(true)} disabled={busy} className="flex-1 py-2.5 rounded-xl border border-overlay/10 text-ink-1 text-sm font-semibold hover:bg-overlay/5">Refuser</button>
                </div>
              </>
            ) : (
              <>
                <label className="block text-xs text-ink-3">Pourquoi tu refuses
                  <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} rows={3} className={input} />
                </label>
                <div className="flex gap-2">
                  <button onClick={() => send(false)} disabled={busy || !reason.trim()} className="flex-1 py-2.5 rounded-xl border border-red-600/30 text-red-300 text-sm font-semibold disabled:opacity-50">Refuser de signer</button>
                  <button onClick={() => setRefusing(false)} className="px-4 py-2.5 rounded-xl text-ink-3 text-sm">Retour</button>
                </div>
              </>
            )}
            <p className="text-xs text-ink-4">Signature électronique simple : on garde ton nom, l'heure, ton adresse IP et l'empreinte du document. Une seule réponse est possible ; ce lien ne donne accès à rien d'autre.</p>
          </div>
        ) : !error && <Loader2 size={18} className="animate-spin text-ink-4" />}
      </main>
    </div>
  );
}
