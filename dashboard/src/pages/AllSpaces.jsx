import React, { useEffect, useState } from 'react';
import { Layers, Loader2, AlertTriangle } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';

// « Tous mes espaces » (v6, web/routes/mySpaces.js): the open tickets of every space where one is
// staff, each with the rights one has there; a click opens the ticket in its space
const PRIO = { urgent: ['Urgente', 'text-red-400'], normal: ['Normale', 'text-ink-3'], low: ['Basse', 'text-ink-4'] };
const REASON = { maintenance: 'espace en maintenance', ip: 'adresse IP non autorisée par cet espace', '2fa': 'cet espace impose la double authentification', permission: 'pas le droit de voir les tickets' };

export default function AllSpaces() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [onlyMine, setOnlyMine] = useState(false);
  useEffect(() => { api.get('/my-spaces/tickets').then(r => setD(r.data)).catch(() => setD(false)); }, []);
  const open = async (guildId, ticketId) => {
    try {
      if (user?.guildId !== guildId) await api.post('/auth/select-guild', { guildId });
      window.location.href = `/tickets/${ticketId}`;
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  if (d === null) return <div className="p-6"><Loader2 size={16} className="animate-spin text-ink-4" /></div>;
  if (d === false) return <div className="p-6 text-sm text-ink-3">Impossible de charger les espaces.</div>;
  const total = d.spaces.reduce((n, s) => n + s.open, 0);
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-1 inline-flex items-center gap-2"><Layers size={18} aria-hidden="true" />Tous mes espaces</h1>
          <p className="text-sm text-ink-3 mt-1">{`${total} ticket(s) ouvert(s) dans ${d.spaces.length} espace(s), avec les droits que tu as dans chacun.`}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} className="accent-primary" />Seulement ceux qui me sont attribués</label>
      </div>
      {d.skipped.length > 0 && (
        <ul className="text-xs text-amber-400 space-y-1">
          {d.skipped.map(s => <li key={s.guildId} className="inline-flex items-center gap-1.5"><AlertTriangle size={12} aria-hidden="true" />{`${s.name} : ${REASON[s.reason] || s.reason}`}</li>)}
        </ul>
      )}
      {d.spaces.map(s => {
        const list = onlyMine ? s.tickets.filter(t => t.mine) : s.tickets;
        return (
          <section key={s.guildId} className="glass-dark rounded-2xl border border-overlay/8 p-4" aria-label={s.name}>
            <h2 className="text-sm font-semibold text-ink-1 mb-2">{s.name} <span className="text-ink-4 font-normal">{`· ${s.open} ouvert(s)${s.open > s.tickets.length ? `, ${s.tickets.length} affiché(s)` : ''}`}</span></h2>
            {list.length === 0 ? <p className="text-xs text-ink-4">Rien à traiter.</p> : (
              <ul className="divide-y divide-overlay/6">
                {list.map(t => (
                  <li key={t.id}>
                    <button type="button" onClick={() => open(s.guildId, t.id)} className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 hover:bg-overlay/3 rounded-lg px-2">
                      <span className="text-xs text-ink-4 font-mono">{`#${t.id}`}</span>
                      <span className="text-sm text-ink-1 flex-1 min-w-48 truncate">{t.subject || '(sans sujet)'}</span>
                      <span className={`text-[11px] ${PRIO[t.priority]?.[1] || 'text-ink-3'}`}>{PRIO[t.priority]?.[0] || t.priority}</span>
                      <span className="text-[11px] text-ink-3 truncate max-w-40">{t.owner_tag}</span>
                      {t.mine && <span className="text-[11px] text-primary-light">à moi</span>}
                      {t.resolved_at && <span className="text-[11px] text-emerald-400">résolu</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
