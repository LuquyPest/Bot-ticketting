import React, { useEffect, useState } from 'react';
import { Lock, Loader2, ArrowLeft, LogOut, Clock } from 'lucide-react';
import api from '../api';
import Badge from '../components/Badge';
import MessageContent from '../components/MessageContent';
import { fmtDate } from '../utils/format';

const SOURCE = { user: 'Membre', reply: 'Réponse du staff', scheduled: 'Message programmé', web: 'Note interne', discord: 'Salon du staff' };

// Read-only page of a temporary guest access (/invite#<token>)
export default function GuestView() {
  const [me, setMe] = useState(undefined);
  const [error, setError] = useState('');
  const [tickets, setTickets] = useState([]);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    document.title = 'Accès invité';
    const token = window.location.hash.slice(1);
    // The token leaves the address bar at once (history, screen sharing)
    if (token) window.history.replaceState(null, '', '/invite');
    const start = token ? api.post('/guest/session', { token }) : Promise.resolve();
    start
      .then(() => api.get('/guest/me'))
      .then(r => { setMe(r.data); return api.get('/guest/tickets'); })
      .then(r => setTickets(r.data))
      .catch(err => { setMe(null); setError(err.response?.data?.error || 'Lien invalide, expiré ou révoqué'); });
  }, []);

  const view = id => api.get(`/guest/tickets/${id}`).then(r => setOpen(r.data)).catch(err => setError(err.response?.data?.error || 'Erreur'));
  const logout = async () => { await api.post('/guest/logout').catch(() => {}); setMe(null); setError('Tu es déconnecté.'); };

  if (me === undefined) return <div data-no-translate className="min-h-screen bg-base flex items-center justify-center"><Loader2 className="animate-spin text-ink-4" /></div>;
  return (
    <div data-no-translate className="min-h-screen bg-base">
      <header className="border-b border-overlay/6 bg-surface/60">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Lock size={16} className="text-primary-light" />
          <span className="text-sm font-bold text-ink-1">Accès invité{me?.guildName ? ` · ${me.guildName}` : ''}</span>
          {me && <button onClick={logout} aria-label="Se déconnecter" className="ml-auto p-1.5 rounded-lg text-ink-3 hover:text-ink-1"><LogOut size={14} /></button>}
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {!me ? (
          <p className="text-sm text-ink-2 text-center py-16" role="alert">{error}</p>
        ) : open ? (
          <>
            <button onClick={() => setOpen(null)} className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-1"><ArrowLeft size={13} /> Tickets partagés</button>
            <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold text-ink-1 flex-1"><span className="font-mono text-ink-4 mr-1.5">#{open.ticket.id}</span>{open.ticket.subject || '—'}</h1>
                <Badge label={open.ticket.status} variant={open.ticket.status} />
              </div>
              <p className="text-[11px] text-ink-4 mt-1">{open.ticket.owner_tag} · ouvert le {fmtDate(open.ticket.created_at)}{open.ticket.closed_at ? ` · fermé le ${fmtDate(open.ticket.closed_at)}` : ''}</p>
            </div>
            <ol className="space-y-2.5">
              {open.messages.map(m => (
                <li key={m.id} className={`rounded-xl border px-4 py-2.5 ${m.source === 'web' || m.source === 'discord' ? 'border-dashed border-overlay/10 bg-overlay/2' : m.source === 'user' ? 'border-overlay/6 bg-surface-card' : 'border-primary/20 bg-primary/5'}`}>
                  <p className="text-[11px] text-ink-3"><strong className="text-ink-1">{m.author_tag}</strong> · {SOURCE[m.source] || 'Événement'} · {fmtDate(m.created_at)}{m.deleted_at ? ' · supprimé par le membre' : ''}</p>
                  <p className="text-sm text-ink-2 mt-1 whitespace-pre-wrap wrap-break-word"><MessageContent text={m.content} /></p>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <div className="rounded-2xl border border-overlay/6 bg-surface-card p-4">
              <p className="text-sm text-ink-1">Bonjour <strong>{me.label}</strong>, voici les tickets partagés avec toi, en lecture seule.</p>
              <p className="text-[11px] text-ink-4 mt-1 inline-flex items-center gap-1"><Clock size={11} /> Accès valable jusqu'au {fmtDate(me.expiresAt)}{me.includeNotes ? ' · notes internes incluses' : ''}</p>
            </div>
            <ul className="space-y-2">
              {tickets.map(t => (
                <li key={t.id}>
                  <button onClick={() => view(t.id)} className="w-full text-left flex items-center gap-2 rounded-2xl border border-overlay/6 bg-surface-card px-4 py-3 hover:border-overlay/12">
                    <span className="font-mono text-ink-4 text-xs">#{t.id}</span>
                    <span className="flex-1 min-w-0 truncate text-sm text-ink-1">{t.subject || '—'}</span>
                    <Badge label={t.status} variant={t.status} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
