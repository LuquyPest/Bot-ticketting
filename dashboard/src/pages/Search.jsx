import React, { useState, useCallback } from 'react';
import { Search as SearchIcon, Ticket, Clock, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const STATUS_STYLES = {
  open:   { cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'Ouvert' },
  closed: { cls: 'text-slate-400 bg-slate-500/10 border-slate-500/20',       label: 'Fermé' },
};

const PRIO_STYLES = {
  urgent: 'text-red-400 bg-red-500/10 border-red-500/20',
  normal: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  low:    'text-slate-400 bg-slate-500/10 border-slate-500/20',
};

function highlight(text, q) {
  if (!q || !text) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-400/20 text-amber-300 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export default function Search() {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const navigate = useNavigate();

  const search = useCallback(async (q) => {
    if (!q.trim() || q.trim().length < 2) return;
    setLoading(true);
    setSearched(true);
    try {
      const r = await api.get(`/analytics/search?q=${encodeURIComponent(q.trim())}`);
      setResults(r.data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleKey = (e) => {
    if (e.key === 'Enter') search(query);
  };

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1">Recherche</h1>
        <p className="text-sm text-ink-3 mt-0.5">Chercher dans les tickets, messages et transcripts</p>
      </div>

      {/* Search input */}
      <div className="relative">
        <SearchIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Rechercher un ticket, un message, un utilisateur…"
          autoFocus
          className="w-full pl-10 pr-4 py-3 rounded-xl bg-surface-card border border-white/[0.08]
                     text-sm text-ink-1 placeholder-ink-4 outline-none focus:border-primary/50
                     transition-colors"
        />
        <button
          onClick={() => search(query)}
          disabled={loading || query.trim().length < 2}
          className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-primary
                     text-white text-xs font-medium disabled:opacity-40 hover:bg-primary-light
                     transition-all flex items-center gap-1.5">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <SearchIcon size={12} />}
          Chercher
        </button>
      </div>

      {/* Results */}
      {!searched && (
        <div className="text-center py-16">
          <SearchIcon size={32} className="mx-auto text-ink-4 mb-3" />
          <p className="text-sm text-ink-4">Commence à taper pour chercher dans les tickets</p>
          <p className="text-xs text-ink-4 mt-1">Cherche dans : sujet, propriétaire, messages staff</p>
        </div>
      )}

      {searched && !loading && results?.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-ink-3">Aucun résultat pour <strong>"{query}"</strong></p>
          <p className="text-xs text-ink-4 mt-1">Essaie d'autres termes ou vérifie l'orthographe</p>
        </div>
      )}

      {results?.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-ink-4">{results.length} résultat{results.length > 1 ? 's' : ''}</p>
          {results.map(ticket => {
            const ss = STATUS_STYLES[ticket.status] || STATUS_STYLES.closed;
            const ps = PRIO_STYLES[ticket.priority] || PRIO_STYLES.normal;
            return (
              <button
                key={ticket.id}
                onClick={() => navigate(`/tickets/${ticket.id}`)}
                className="w-full text-left bg-surface-card border border-white/[0.06] rounded-xl p-4
                           hover:border-primary/30 hover:bg-white/[0.02] transition-all space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Ticket size={13} className="text-ink-4 flex-shrink-0" />
                    <span className="text-sm font-medium text-ink-1">
                      #{ticket.id} · {highlight(ticket.ownerTag, query)}
                    </span>
                    {ticket.subject && (
                      <span className="text-ink-4 text-xs truncate">
                        · {highlight(ticket.subject, query)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${ss.cls}`}>
                      {ss.label}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${ps}`}>
                      {ticket.priority}
                    </span>
                  </div>
                </div>

                {/* Matched notes snippets */}
                {ticket.matches?.slice(0, 2).map((m, i) => (
                  <div key={i} className="flex items-start gap-2 pl-5">
                    <span className="text-[10px] text-ink-4 font-medium mt-0.5 flex-shrink-0">{m.author}</span>
                    <p className="text-[11px] text-ink-3 line-clamp-2">
                      {highlight(m.content, query)}
                    </p>
                  </div>
                ))}

                <p className="text-[10px] text-ink-4 pl-5">
                  <Clock size={9} className="inline mr-1" />
                  {new Date(ticket.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
