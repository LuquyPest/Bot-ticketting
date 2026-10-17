import React, { useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import MessageSearch from '../components/MessageSearch';
import Select from '../components/Select';

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'open', label: 'Ouverts' },
  { value: 'closed', label: 'Fermés' },
];

// Full-text search in every conversation (member messages, staff replies, internal notes),
// ticket subjects and member names
export default function Search() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1">Recherche</h1>
        <p className="text-sm text-ink-3 mt-0.5">Dans tous les messages des tickets (membre, staff, notes internes), les sujets et les pseudos</p>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <div className="relative flex-1 min-w-56">
          <SearchIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Rechercher dans les tickets"
            placeholder="Un mot, un n° de commande, un pseudo…"
            autoFocus
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-card border border-overlay/8
                       text-sm text-ink-1 placeholder-ink-4 outline-hidden focus:border-primary/50 transition-colors"
          />
        </div>
        <Select className="w-44" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </div>

      {query.trim() ? (
        <MessageSearch q={query} status={status} />
      ) : (
        <div className="text-center py-16">
          <SearchIcon size={32} className="mx-auto text-ink-4 mb-3" />
          <p className="text-sm text-ink-3">Commence à taper pour chercher</p>
          <p className="text-xs text-ink-4 mt-1">Les mots de 3 lettres ou plus trouvent aussi leurs variantes (« rembours » trouve « remboursement »)</p>
        </div>
      )}
    </div>
  );
}
