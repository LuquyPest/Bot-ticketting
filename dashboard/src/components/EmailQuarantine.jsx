import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';

// Tickets par e-mail → Quarantaine (v5.0): the messages kept aside (spam, sender outside the
// allowed domains, too large), 30 days. Release = processed as if it had just arrived.
export default function EmailQuarantine({ onCount }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  // The parent's callback changes on every render: kept in a ref, loading happens once
  const countRef = useRef(onCount);
  countRef.current = onCount;
  const load = useCallback(() => api.get('/email/quarantine').then(r => { setList(r.data); countRef.current?.(r.data.length); }).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);
  if (list === null) return <Loader2 size={14} className="animate-spin text-ink-4" />;
  const act = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); setList(r.data.quarantine); countRef.current?.(r.data.quarantine.length); toast.success(typeof ok === 'function' ? ok(r.data) : ok); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  if (!list.length) return <p className="text-xs text-ink-4">Aucun message en quarantaine.</p>;
  return (
    <ul className="divide-y divide-overlay/5 rounded-xl border border-overlay/8">
      {list.map(q => (
        <li key={q.id} className="px-3 py-2.5 flex flex-wrap items-start gap-3 text-xs">
          <ShieldAlert size={14} className="text-amber-300 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-ink-1 font-medium truncate">{q.subject || '(sans objet)'}</p>
            <p className="text-ink-3 truncate">{q.from_name ? `${q.from_name} · ` : ''}{q.from_address} · {new Date(q.received_at).toLocaleString(uiLocale(), { dateStyle: 'short', timeStyle: 'short' })}</p>
            <p className="text-amber-300 mt-0.5">{q.reason}</p>
            {q.excerpt && <p className="text-ink-4 mt-0.5 line-clamp-2">{q.excerpt}</p>}
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button type="button" disabled={busy} onClick={() => act(() => api.post(`/email/quarantine/${q.id}/release`), d => (d.ticketId ? `Libéré : ticket #${d.ticketId}` : 'Libéré'))}
              className="px-2.5 py-1 rounded-md border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Libérer</button>
            <button type="button" disabled={busy} onClick={() => act(() => api.delete(`/email/quarantine/${q.id}`), 'Supprimé')}
              className="px-2.5 py-1 rounded-md border border-overlay/8 text-ink-3 hover:text-red-400 disabled:opacity-50">Supprimer</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
