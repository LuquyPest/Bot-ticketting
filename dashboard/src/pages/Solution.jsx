import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import api from '../api';
import MessageContent from '../components/MessageContent';
import { STR, MEMBER_LANG } from '../i18n/member';

// /solution#<space>.<token>: the requester confirms the solution the staff proposed
// (utils/resolution.js). The token stays in the fragment: never sent in a URL to the server.
export default function Solution() {
  const token = window.location.hash.slice(1);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!token) { setError(STR.solGone); return; }
    api.post('/resolution/link', { token }).then(r => setInfo(r.data)).catch(() => setError(STR.solGone));
  }, [token]);
  const accept = async () => {
    setBusy(true);
    try { await api.post('/resolution/accept', { token }); setDone(true); window.history.replaceState(null, '', '/solution'); }
    catch { setError(STR.solGone); }
    setBusy(false);
  };
  return (
    <div data-no-translate lang={MEMBER_LANG} className="min-h-screen bg-base flex items-center justify-center p-4">
      <main className="w-full max-w-lg bg-surface-card border border-overlay/8 rounded-2xl p-6 space-y-4">
        {error ? <p className="text-sm text-ink-2 text-center" role="alert">{error}</p>
          : !info ? <div className="flex justify-center py-6"><Loader2 className="animate-spin text-ink-4" /></div>
          : done ? (
            <p className="text-sm text-ink-1 text-center inline-flex items-center gap-2 w-full justify-center"><CheckCircle2 size={16} className="text-emerald-400" aria-hidden="true" />{STR.solThanks}</p>
          ) : (
            <>
              <p className="text-xs text-ink-3">{info.space} · #{info.ticketId}{info.subject ? ` · ${info.subject}` : ''}</p>
              <h1 className="text-lg font-bold text-ink-1">{STR.solTitle}</h1>
              <div className="text-sm text-ink-1 whitespace-pre-wrap bg-overlay/4 rounded-xl px-4 py-3"><MessageContent text={info.solution} /></div>
              <button onClick={accept} disabled={busy} className="w-full py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {STR.solAccept}
              </button>
              <p className="text-xs text-ink-3 text-center">{STR.solNotYet}</p>
            </>
          )}
      </main>
    </div>
  );
}
