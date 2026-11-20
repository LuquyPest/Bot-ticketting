import React, { useEffect, useState } from 'react';
import { Download, PenLine, Send } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';

// Signatures of a change, a release or a ticket (v8, utils/signatures.js): ask someone to sign
// the frozen document by e-mail; follow the answers; download the certificate of a signed one
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const STATUS = { pending: ['En attente', 'text-amber-300'], signed: ['Signé', 'text-emerald-400'], declined: ['Refusé', 'text-red-400'] };

export default function SignaturesPanel({ type, id, compact = false }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email: '', name: '', message: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/signatures', { params: { type, id } }).then(r => setList(Array.isArray(r.data?.signatures) ? r.data.signatures : [])).catch(() => setList(null)); }, [type, id]);
  if (list === null) return null;
  const ask = async () => {
    setBusy(true);
    try { const r = await api.post('/signatures', { type, id, ...f }); setList(r.data.signatures || []); setF({ email: '', name: '', message: '' }); setOpen(false); toast.success('Demande de signature envoyée'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const download = async s => {
    try {
      const r = await api.get(`/signatures/${s.id}/certificate`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = Object.assign(document.createElement('a'), { href: url, download: `signature-${s.id}.pdf` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch { toast.error('Certificat indisponible'); }
  };
  return (
    <section className={`${compact ? '' : 'bg-surface-card border border-overlay/6 rounded-2xl p-4'} space-y-2`} aria-label="Signatures">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-ink-2 inline-flex items-center gap-1.5 mr-auto"><PenLine size={12} aria-hidden="true" />Signatures</h3>
        <button type="button" onClick={() => setOpen(o => !o)} className="text-[11px] text-primary-light hover:underline">Demander une signature</button>
      </div>
      {list.length === 0 && !open && <p className="text-[11px] text-ink-4">Aucune signature demandée.</p>}
      <ul className="space-y-1">
        {list.map(s => (
          <li key={s.id} className="text-[11px] flex flex-wrap items-center gap-1.5">
            <span className="text-ink-1" translate="no">{s.signer.name}</span>
            <span className={STATUS[s.status]?.[1] || 'text-ink-4'}>{STATUS[s.status]?.[0] || s.status}</span>
            {s.signedAt && <span className="text-ink-4">{new Date(s.signedAt).toLocaleString(uiLocale())}</span>}
            {s.reason && <span className="text-ink-3">{`— ${s.reason}`}</span>}
            {s.status === 'signed' && <button type="button" onClick={() => download(s)} aria-label={`Certificat de signature de ${s.signer.name}`} className="text-ink-3 hover:text-ink-1"><Download size={11} /></button>}
          </li>
        ))}
      </ul>
      {open && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            <input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} placeholder="Nom de la personne" aria-label="Nom de la personne qui signe" className={INPUT} />
            <input type="email" value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))} placeholder="Son adresse e-mail" aria-label="Adresse e-mail de la personne qui signe" className={INPUT} />
          </div>
          <textarea value={f.message} onChange={e => setF(x => ({ ...x, message: e.target.value }))} rows={2} maxLength={2000} placeholder="Précisions ajoutées au document (facultatif)" aria-label="Précisions ajoutées au document" className={`${INPUT} w-full`} />
          <button type="button" onClick={ask} disabled={busy || !f.email || !f.name} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white inline-flex items-center gap-1 disabled:opacity-50"><Send size={11} />Envoyer la demande</button>
          <p className="text-[10px] text-ink-4">Le document est figé à l'envoi (texte et empreinte SHA-256) ; la personne reçoit un lien valable 14 jours.</p>
        </div>
      )}
    </section>
  );
}
