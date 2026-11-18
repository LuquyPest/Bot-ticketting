import React, { useState } from 'react';
import { CheckCircle2, Loader2, Undo2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';

// Fiche ticket → Actions → Résoudre (v5.1): the solution goes to the requester, who confirms (the
// ticket closes) or writes again (it goes on); without an answer it closes after N days
export default function ResolutionPanel({ ticket, settings, onChange }) {
  const [open, setOpen] = useState(false);
  const [solution, setSolution] = useState('');
  const [busy, setBusy] = useState(false);
  if (!settings?.enabled || ticket.status !== 'open') return null;
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setOpen(false); setSolution(''); onChange?.(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  if (ticket.resolved_at) {
    const closesAt = settings.autoCloseDays ? new Date(new Date(ticket.resolved_at).getTime() + settings.autoCloseDays * 864e5) : null;
    return (
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-2 text-xs">
        <p className="font-semibold text-emerald-300 inline-flex items-center gap-1.5"><CheckCircle2 size={13} aria-hidden="true" />Résolu, en attente du demandeur</p>
        {ticket.resolution && <p className="text-ink-1 whitespace-pre-wrap bg-overlay/4 rounded-lg px-2.5 py-2">{ticket.resolution}</p>}
        <p className="text-ink-3">{`Par ${ticket.resolved_by_tag || '—'} le ${new Date(ticket.resolved_at).toLocaleString(uiLocale(), { dateStyle: 'short', timeStyle: 'short' })}`}{closesAt ? ` · fermeture automatique le ${closesAt.toLocaleDateString(uiLocale(), { dateStyle: 'short' })}` : ''}</p>
        <button type="button" onClick={() => run(() => api.post(`/tickets/${ticket.id}/unresolve`), 'Résolution annulée')} disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-overlay/8 text-ink-3 hover:text-ink-1 disabled:opacity-50"><Undo2 size={11} aria-hidden="true" />Annuler la résolution</button>
      </div>
    );
  }
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)}
      className="w-full py-2.5 px-3 text-xs rounded-xl font-semibold border bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20 inline-flex items-center justify-center gap-1.5">
      <CheckCircle2 size={13} aria-hidden="true" /> Résoudre
    </button>
  );
  return (
    <div className="space-y-2">
      <textarea value={solution} onChange={e => setSolution(e.target.value)} rows={4} maxLength={4000} autoFocus aria-label="Solution envoyée au demandeur" placeholder="La solution, envoyée au demandeur"
        className="w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary" />
      <p className="text-[11px] text-ink-4">{`Le demandeur confirme (le ticket se ferme) ou répond (il reprend)${settings.autoCloseDays ? ` ; sans réponse, fermeture dans ${settings.autoCloseDays} jour(s)` : ''}.`}</p>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => run(() => api.post(`/tickets/${ticket.id}/resolve`, { solution }), 'Solution envoyée')} disabled={busy || !solution.trim()}
          className="flex-1 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
          {busy && <Loader2 size={12} className="animate-spin" />} Envoyer la solution
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-3 hover:text-ink-1">Annuler</button>
      </div>
    </div>
  );
}
