import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Loader2, BellRing, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useSSE } from '../hooks/useSSE';
import { uiLocale } from '../i18n';

const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const STATUS = {
  pending:   ['En attente', 'text-amber-300'],
  approved:  ['Accordée', 'text-emerald-300'],
  rejected:  ['Refusée', 'text-red-300'],
  cancelled: ['Annulée', 'text-ink-4'],
};
const fmt = d => (d ? new Date(d).toLocaleString(uiLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '');

// Fiche ticket → Validation (v4.2): ask a staff member, or someone by e-mail, for their agreement;
// the person asked answers here (staff) or from the link they received (e-mail)
export default function ApprovalPanel({ ticketId, open, me, canAsk, isFounder, stages, panelCard, onChange }) {
  const [list, setList] = useState(null);
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`/tickets/${ticketId}/approvals`).then(r => setList(r.data)).catch(() => setList([])), [ticketId]);
  useEffect(() => { load(); }, [load]);
  useSSE({ approval: d => { if (d.ticketId === ticketId) load(); }, ticket: d => { if (d.id === ticketId && d.approval) load(); } });
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); setComment(''); await load(); onChange?.(); return true; }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; }
    finally { setBusy(false); }
  };
  const startForm = () => {
    setForm({ kind: 'staff', approverId: '', approverEmail: '', approverName: '', reason: '', nextStage: '' });
    if (!staff.length) api.get('/tickets/staff').then(r => setStaff((r.data || []).filter(s => s.user_id !== me))).catch(() => {});
  };
  if (list === null) return null;
  const pending = list.find(a => a.status === 'pending');
  const history = list.filter(a => a !== pending).slice(0, 3);
  if (!open && !list.length) return null;
  return (
    <div className={panelCard}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-2 inline-flex items-center gap-1.5"><BadgeCheck size={12} aria-hidden="true" />Validation</p>
      {pending && (
        <div className="space-y-2 text-xs">
          <p className="text-ink-2"><span className="text-amber-300 font-semibold">En attente</span>{` · demandée à ${pending.approver.name} par ${pending.requestedBy}`}</p>
          <p className="text-ink-1 bg-overlay/4 rounded-lg px-2.5 py-2 whitespace-pre-wrap">{pending.reason}</p>
          {pending.nextStage && <p className="text-ink-4">{`Une fois accordée : passe en « ${stages.find(s => s.key === pending.nextStage)?.label || pending.nextStage} »`}</p>}
          {pending.approver.id === me && (
            <div className="space-y-1.5">
              <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} rows={2} placeholder="Commentaire (facultatif)" aria-label="Commentaire de la décision" className={INPUT} />
              <div className="flex gap-1.5">
                <button onClick={() => run(() => api.post(`/tickets/${ticketId}/approvals/${pending.id}/decide`, { decision: 'approved', comment }), 'Validation accordée')} disabled={busy}
                  className="flex-1 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold disabled:opacity-50">Accorder</button>
                <button onClick={() => run(() => api.post(`/tickets/${ticketId}/approvals/${pending.id}/decide`, { decision: 'rejected', comment }), 'Validation refusée')} disabled={busy}
                  className="flex-1 py-1.5 rounded-lg border border-overlay/10 text-ink-1 font-semibold hover:bg-overlay/5 disabled:opacity-50">Refuser</button>
              </div>
            </div>
          )}
          {canAsk && (
            <div className="flex gap-1.5">
              <button onClick={() => run(() => api.post(`/tickets/${ticketId}/approvals/${pending.id}/remind`), 'Relance envoyée')} disabled={busy}
                className="px-2 py-1 rounded-lg border border-overlay/8 text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><BellRing size={11} aria-hidden="true" />Relancer</button>
              {(pending.requestedById === me || isFounder) && (
                <button onClick={() => run(() => api.post(`/tickets/${ticketId}/approvals/${pending.id}/cancel`), 'Demande annulée')} disabled={busy}
                  className="px-2 py-1 rounded-lg border border-overlay/8 text-ink-3 hover:text-red-400 inline-flex items-center gap-1"><X size={11} aria-hidden="true" />Annuler</button>
              )}
              {pending.remindCount > 0 && <span className="text-ink-4 self-center">{`${pending.remindCount} relance(s)`}</span>}
            </div>
          )}
        </div>
      )}
      {!pending && open && canAsk && !form && (
        <button onClick={startForm} className="w-full py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2 hover:text-ink-1">Demander une validation</button>
      )}
      {!pending && form && (
        <div className="space-y-1.5 text-xs">
          <div role="radiogroup" aria-label="Qui doit valider" className="flex gap-1">
            {[['staff', 'Le staff'], ['email', 'Par e-mail']].map(([k, l]) => (
              <button key={k} role="radio" aria-checked={form.kind === k} onClick={() => setForm(f => ({ ...f, kind: k }))}
                className={`flex-1 py-1 rounded-md border ${form.kind === k ? 'bg-primary/15 border-primary/40 text-ink-1' : 'border-overlay/8 text-ink-3'}`}>{l}</button>
            ))}
          </div>
          {form.kind === 'staff' ? (
            <select value={form.approverId} onChange={e => setForm(f => ({ ...f, approverId: e.target.value }))} aria-label="Personne qui valide" className={INPUT}>
              <option value="">Choisir une personne…</option>
              {staff.map(s => <option key={s.user_id} value={s.user_id}>{s.username}</option>)}
            </select>
          ) : (
            <>
              <input type="email" value={form.approverEmail} onChange={e => setForm(f => ({ ...f, approverEmail: e.target.value }))} placeholder="responsable@exemple.com" aria-label="Adresse e-mail de la personne qui valide" className={INPUT} />
              <input value={form.approverName} onChange={e => setForm(f => ({ ...f, approverName: e.target.value }))} maxLength={100} placeholder="Nom (facultatif)" aria-label="Nom de la personne qui valide" className={INPUT} />
            </>
          )}
          <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} maxLength={2000} rows={3} placeholder="Ce qui doit être validé (remboursement de 120 €, accès exceptionnel…)" aria-label="Ce qui doit être validé" className={INPUT} />
          <select value={form.nextStage} onChange={e => setForm(f => ({ ...f, nextStage: e.target.value }))} aria-label="Statut une fois accordée" className={INPUT}>
            <option value="">Une fois accordée : statut inchangé</option>
            {stages.map(s => <option key={s.key} value={s.key}>{`Une fois accordée : ${s.label}`}</option>)}
          </select>
          <div className="flex gap-1.5">
            <button onClick={async () => { if (await run(() => api.post(`/tickets/${ticketId}/approvals`, form.kind === 'staff' ? { approverId: form.approverId, reason: form.reason, nextStage: form.nextStage || null } : { approverEmail: form.approverEmail, approverName: form.approverName, reason: form.reason, nextStage: form.nextStage || null }), 'Validation demandée')) setForm(null); }}
              disabled={busy || !form.reason.trim() || (form.kind === 'staff' ? !form.approverId : !form.approverEmail)}
              className="flex-1 py-1.5 rounded-lg bg-primary text-white font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-1.5">{busy && <Loader2 size={12} className="animate-spin" />}Demander</button>
            <button onClick={() => setForm(null)} className="px-2.5 py-1.5 rounded-lg border border-overlay/8 text-ink-3">Annuler</button>
          </div>
        </div>
      )}
      {history.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px]">
          {history.map(a => (
            <li key={a.id} className="text-ink-3">
              <span className={STATUS[a.status][1]}>{STATUS[a.status][0]}</span>{` · ${a.approver.name}${a.decidedAt ? `, ${fmt(a.decidedAt)}` : ''}`}{a.comment ? ` — ${a.comment}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
