import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserPlus, Copy, Ban, Loader2, Clock, Eye } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../utils/confirmToast';
import { fmtDate } from '../utils/format';

const input = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:border-primary/50';
const DURATIONS = [['1h', '1 heure'], ['24h', '24 heures'], ['7d', '7 jours'], ['30d', '30 jours']];

// Read-only access to chosen tickets for someone outside the server, expiring by itself
export default function GuestInvites() {
  const [params] = useSearchParams();
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ label: '', tickets: params.get('ticket') || '', includeNotes: false, duration: '7d' });
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { api.get('/guest-invites').then(r => setList(r.data)).catch(() => setList([])); }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ticketIds = form.tickets.split(/[\s,;#]+/).map(Number).filter(Boolean);
      const { data } = await api.post('/guest-invites', { label: form.label, ticketIds, includeNotes: form.includeNotes, duration: form.duration });
      setCreated({ ...data, label: form.label });
      setForm(f => ({ ...f, label: '', tickets: '' }));
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const copy = () => navigator.clipboard?.writeText(created.link).then(() => toast.success('Lien copié')).catch(() => {});
  const revoke = async (inv) => {
    if (!await confirmToast(`Révoquer l'accès de « ${inv.label} » ? Le lien cessera de fonctionner immédiatement.`)) return;
    try { await api.delete(`/guest-invites/${inv.id}`); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const status = inv => (inv.revoked_at ? ['Révoqué', 'text-red-400'] : inv.live ? ['Actif', 'text-emerald-400'] : ['Expiré', 'text-ink-4']);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1">Accès invités</h1>
        <p className="text-sm text-ink-3 mt-0.5">Donne à quelqu'un d'extérieur (modérateur d'un partenaire, avocat…) un accès en lecture seule à certains tickets, sans compte Discord. L'accès expire tout seul, se révoque à tout moment, et chaque consultation est inscrite au journal.</p>
      </div>

      <form onSubmit={create} className="bg-surface-card border border-overlay/6 rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-ink-2">Nouvel accès</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-ink-3">Nom de l'invité</span>
            <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} maxLength={100} placeholder="Maître Dupont" className={`${input} mt-1`} />
          </label>
          <label className="block"><span className="text-xs text-ink-3">Tickets (numéros séparés par des virgules)</span>
            <input value={form.tickets} onChange={e => setForm(f => ({ ...f, tickets: e.target.value }))} placeholder="12, 45" className={`${input} mt-1`} />
          </label>
          <label className="block"><span className="text-xs text-ink-3">Durée</span>
            <select value={form.duration} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} className={`${input} mt-1`}>
              {DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2 sm:mt-6">
            <input type="checkbox" checked={form.includeNotes} onChange={e => setForm(f => ({ ...f, includeNotes: e.target.checked }))} />
            Inclure les notes internes et le salon du staff
          </label>
        </div>
        <button type="submit" disabled={busy || !form.label.trim() || !form.tickets.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Créer le lien
        </button>
        {created && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-3 space-y-2" role="status">
            <p className="text-xs text-ink-1">Lien pour <strong>{created.label}</strong> — il ne sera plus affiché : copie-le maintenant et transmets-le de façon sûre.</p>
            <div className="flex gap-2">
              <input readOnly value={created.link} aria-label="Lien d'accès invité" className={`${input} font-mono text-xs`} onFocus={e => e.target.select()} />
              <button type="button" onClick={copy} aria-label="Copier le lien" className="px-3 rounded-xl border border-overlay/8 text-ink-2 hover:text-ink-1"><Copy size={14} /></button>
            </div>
          </div>
        )}
      </form>

      <section className="space-y-2">
        {!list && <div className="h-16 rounded-2xl bg-overlay/2.5 animate-pulse" />}
        {list && !list.length && <p className="text-sm text-ink-4">Aucun accès invité pour l'instant.</p>}
        {list?.map(inv => {
          const [label, cls] = status(inv);
          return (
            <article key={inv.id} className="bg-surface-card border border-overlay/6 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-1">{inv.label} <span className={`text-xs font-semibold ${cls}`}>· {label}</span></p>
                <p className="text-[11px] text-ink-4">
                  Tickets {inv.ticket_ids.map(i => `#${i}`).join(', ')}{inv.include_notes ? ' · avec notes internes' : ''} · par {inv.created_by_tag}
                </p>
                <p className="text-[11px] text-ink-4 flex flex-wrap gap-3">
                  <span className="inline-flex items-center gap-1"><Clock size={10} /> {inv.revoked_at ? `révoqué le ${fmtDate(inv.revoked_at)}` : `expire le ${fmtDate(inv.expires_at)}`}</span>
                  <span className="inline-flex items-center gap-1"><Eye size={10} /> {inv.uses} ouverture(s){inv.last_used_at ? `, dernière le ${fmtDate(inv.last_used_at)}` : ''}</span>
                </p>
              </div>
              {inv.live && (
                <button onClick={() => revoke(inv)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400 border border-red-500/25 hover:bg-red-500/10"><Ban size={12} /> Révoquer</button>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}
