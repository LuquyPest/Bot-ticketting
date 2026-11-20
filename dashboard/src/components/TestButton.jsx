import React, { useState } from 'react';
import { CheckCircle2, FlaskConical, Loader2, XCircle } from 'lucide-react';
import api from '../api';

// « Tester » (v8, conception/v8.md §3.1): a real call with the saved settings; the answer is said
// plainly next to the button. `describe` turns a success into a sentence when the server gives no detail.
export default function TestButton({ url, body, label = 'Tester', describe, disabled }) {
  const [state, setState] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setState(null);
    try {
      const { data } = await api.post(url, body || {});
      setState({ ok: true, text: data.detail || (describe ? describe(data) : 'Ça fonctionne.') });
    } catch (err) {
      setState({ ok: false, text: err.response?.data?.error || 'Échec de l\'essai' });
    } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={busy || disabled} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5 disabled:opacity-50">
        {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <FlaskConical size={12} aria-hidden="true" />}{label}
      </button>
      <span role="status" className={`text-[11px] inline-flex items-center gap-1 ${state ? (state.ok ? 'text-emerald-400' : 'text-red-400') : ''}`}>
        {state && (state.ok ? <CheckCircle2 size={12} aria-hidden="true" /> : <XCircle size={12} aria-hidden="true" />)}{state?.text}
      </span>
    </span>
  );
}
