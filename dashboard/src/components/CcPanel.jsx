import React, { useCallback, useEffect, useState } from 'react';
import { Mail, Plus, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';

// Fiche ticket → Copies (v5.0): the people in copy of a ticket opened by e-mail. They receive
// everything sent to the requester, and can answer in the thread.
export default function CcPanel({ ticketId, canEdit, panelCard }) {
  const [data, setData] = useState(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`/tickets/${ticketId}/cc`).then(r => setData(r.data)).catch(() => setData(null)), [ticketId]);
  useEffect(() => { load(); }, [load]);
  if (!data?.available) return null;
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); setData(d => ({ ...d, cc: r.data.cc })); if (ok) toast.success(ok); return true; }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; }
    finally { setBusy(false); }
  };
  const add = async e => {
    e.preventDefault();
    if (!address.trim()) return;
    if (await run(() => api.post(`/tickets/${ticketId}/cc`, { address: address.trim() }), 'Copie ajoutée')) setAddress('');
  };
  return (
    <div className={panelCard}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-2 inline-flex items-center gap-1.5"><Mail size={12} aria-hidden="true" />Copies</p>
      {!data.cc.length ? <p className="text-xs text-ink-4">Personne en copie</p> : (
        <ul className="space-y-1">
          {data.cc.map(c => (
            <li key={c.id} className="flex items-center gap-1.5 text-xs">
              <span className="flex-1 min-w-0 truncate text-ink-2" title={c.address}>{c.name ? `${c.name} · ` : ''}<span className="text-ink-1">{c.address}</span></span>
              {canEdit && (
                <button type="button" onClick={() => run(() => api.delete(`/tickets/${ticketId}/cc/${c.id}`), 'Copie retirée')} disabled={busy}
                  aria-label={`Retirer ${c.address} des copies`} title="Retirer" className="p-1 rounded text-ink-4 hover:text-red-400 disabled:opacity-50"><X size={11} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && data.cc.length < 10 && (
        <form onSubmit={add} className="flex gap-1.5 mt-2">
          <input type="email" value={address} onChange={e => setAddress(e.target.value)} placeholder="adresse@exemple.com" aria-label="Ajouter une copie" className={INPUT} maxLength={254} />
          <button type="submit" disabled={busy || !address.trim()} aria-label="Ajouter en copie" className="px-2 rounded-lg border border-overlay/8 text-ink-3 hover:text-ink-1 disabled:opacity-50"><Plus size={12} /></button>
        </form>
      )}
      <p className="text-[11px] text-ink-4 mt-2">Elles reçoivent ce qui part au demandeur et peuvent répondre dans le fil.</p>
    </div>
  );
}
