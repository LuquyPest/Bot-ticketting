import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, AtSign } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const EMPTY = { address: '', displayName: '', subject: '', tagId: '', replyFrom: false };

// Paramètres → Intégrations → Tickets par e-mail → Autres adresses (v4.1): addresses delivered to
// the same mailbox (aliases, redirections), each routed to a subject and/or a tag
export default function EmailAddresses() {
  const [d, setD] = useState(null);
  const [rows, setRows] = useState([]);
  const [add, setAdd] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const apply = data => {
    setD(data);
    setRows(data.addresses.map(a => ({ id: a.id, address: a.address, displayName: a.display_name || '', subject: a.subject || '', tagId: a.tag_id || '', replyFrom: a.reply_from })));
  };
  useEffect(() => { api.get('/email/addresses').then(r => apply(r.data)).catch(() => setD(false)); }, []);
  if (d === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (d === false) return null;
  const run = async (fn, ok) => {
    setBusy(true);
    try { apply((await fn()).data); toast.success(ok); return true; } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; }
    finally { setBusy(false); }
  };
  const body = r => ({ ...r, tagId: r.tagId ? Number(r.tagId) : null });
  const setRow = (i, k, v) => setRows(x => x.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const fields = (r, onChange) => (
    <>
      <input value={r.address} onChange={e => onChange('address', e.target.value)} type="email" placeholder="facturation@exemple.com" aria-label="Adresse" className={INPUT} />
      <input value={r.displayName} onChange={e => onChange('displayName', e.target.value)} placeholder="Nom affiché (facultatif)" aria-label="Nom affiché" className={INPUT} />
      <select value={r.subject} onChange={e => onChange('subject', e.target.value)} aria-label="Sujet" className={INPUT}>
        <option value="">Sujet : celui de l'e-mail</option>
        {d.subjects.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={r.tagId} onChange={e => onChange('tagId', e.target.value)} aria-label="Tag" className={INPUT}>
        <option value="">Aucun tag</option>
        {d.tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <label className="flex items-center gap-1.5 text-xs text-ink-2 whitespace-nowrap">
        <input type="checkbox" checked={!!r.replyFrom} onChange={e => onChange('replyFrom', e.target.checked)} className="accent-primary" />
        Répondre depuis cette adresse
      </label>
    </>
  );
  const grid = 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_auto_auto] items-center';
  return (
    <fieldset className="space-y-2 border-t border-overlay/6 pt-3">
      <legend className="text-xs font-semibold text-ink-2 inline-flex items-center gap-1.5"><AtSign size={13} aria-hidden="true" />Autres adresses</legend>
      <p className="text-xs text-ink-4">Des adresses qui arrivent dans cette même boîte (alias, redirections). Un e-mail reçu sur l'une d'elles ouvre un ticket avec son sujet et son tag : le tag le rend visible des rôles qui y sont rattachés (une équipe). « Répondre depuis cette adresse » demande que le serveur d'envoi accepte cette adresse d'expéditeur.</p>
      {rows.map((r, i) => (
        <div key={r.id} className={grid}>
          {fields(r, (k, v) => setRow(i, k, v))}
          <div className="flex gap-1">
            <button onClick={() => run(() => api.put(`/email/addresses/${r.id}`, body(r)), 'Adresse enregistrée')} disabled={busy} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Enregistrer</button>
            <button onClick={() => window.confirm(`Retirer ${r.address} ?`) && run(() => api.delete(`/email/addresses/${r.id}`), 'Adresse retirée')} disabled={busy} aria-label={`Retirer ${r.address}`} title="Retirer"
              className="p-1.5 rounded-lg border border-overlay/8 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>
          </div>
        </div>
      ))}
      <div className={grid}>
        {fields(add, (k, v) => setAdd(x => ({ ...x, [k]: v })))}
        <button onClick={async () => { if (await run(() => api.post('/email/addresses', body(add)), 'Adresse ajoutée')) setAdd(EMPTY); }} disabled={busy || !add.address}
          className="px-2.5 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1 disabled:opacity-50"><Plus size={12} aria-hidden="true" />Ajouter</button>
      </div>
    </fieldset>
  );
}
