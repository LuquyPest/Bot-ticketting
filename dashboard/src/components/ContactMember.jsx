import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquarePlus, X, Loader2, Search } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const input = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:border-primary/50';

// The staff opens a ticket to contact a member of the server (sanction, follow-up, refund…):
// the message is sent to them by DM and the conversation continues as a normal ticket.
export default function ContactMember() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [member, setMember] = useState(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!open || member || query.trim().length < 2) { setResults([]); return undefined; }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSearching(true);
      api.get('/tickets/member-search', { params: { q: query.trim() } })
        .then(r => setResults(r.data)).catch(() => setResults([])).finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query, open, member]);

  const close = () => { setOpen(false); setMember(null); setQuery(''); setSubject(''); setMessage(''); };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post('/tickets/open', { userId: member.id, subject: subject.trim() || null, message: message.trim() });
      toast.success(`Ticket #${data.id} ouvert, message envoyé à ${member.displayName}`);
      close();
      navigate(`/tickets/${data.id}`);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-primary/15 border border-primary/30 text-primary-light hover:bg-primary/25 text-xs font-medium transition-all duration-150">
        <MessageSquarePlus size={13} /> Contacter un membre
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
          <form role="dialog" aria-modal="true" aria-labelledby="contact-title" onSubmit={submit} onClick={e => e.stopPropagation()}
            className="w-full max-w-md bg-surface-card border border-overlay/8 rounded-2xl p-5 space-y-3 shadow-2xl">
            <div className="flex items-center">
              <h2 id="contact-title" className="flex-1 text-sm font-semibold text-ink-1">Contacter un membre</h2>
              <button type="button" onClick={close} aria-label="Fermer" className="text-ink-4 hover:text-ink-1"><X size={14} /></button>
            </div>
            <p className="text-xs text-ink-3">Un ticket est ouvert et ton message lui est envoyé en MP. Il répond simplement au bot, comme pour un ticket normal.</p>
            {member ? (
              <div className="flex items-center gap-2 rounded-xl border border-overlay/8 px-3 py-2">
                <img src={member.avatar} alt="" className="w-6 h-6 rounded-full" />
                <span className="flex-1 min-w-0 text-sm text-ink-1 truncate" translate="no">{member.displayName} <span className="text-ink-4">@{member.username}</span></span>
                <button type="button" onClick={() => setMember(null)} className="text-xs text-ink-3 hover:text-ink-1">Changer</button>
              </div>
            ) : (
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" aria-hidden="true" />
                <input value={query} onChange={e => setQuery(e.target.value)} autoFocus placeholder="Pseudo ou ID Discord du membre"
                  aria-label="Membre à contacter" className={`${input} pl-8`} />
                {(searching || results.length > 0 || query.trim().length >= 2) && (
                  <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-overlay/8 bg-surface-card shadow-xl" role="listbox">
                    {searching && <li className="px-3 py-2 text-xs text-ink-3">Recherche…</li>}
                    {!searching && !results.length && <li className="px-3 py-2 text-xs text-ink-4">Aucun membre trouvé sur le serveur</li>}
                    {results.map(m => (
                      <li key={m.id}>
                        <button type="button" role="option" aria-selected="false" onClick={() => { setMember(m); setResults([]); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-overlay/6">
                          <img src={m.avatar} alt="" className="w-5 h-5 rounded-full" />
                          <span className="text-sm text-ink-1 truncate" translate="no">{m.displayName} <span className="text-ink-4">@{m.username}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={100} placeholder="Sujet (facultatif)" aria-label="Sujet" className={input} />
            <textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} rows={5} required
              placeholder="Message envoyé au membre" aria-label="Message" className={`${input} resize-y`} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="px-3 py-2 rounded-lg text-sm text-ink-3 hover:text-ink-1">Annuler</button>
              <button type="submit" disabled={busy || !member || !message.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
                {busy && <Loader2 size={14} className="animate-spin" />} Ouvrir le ticket
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
