import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Inbox, Loader2 } from 'lucide-react';
import api from '../api';
import Badge from './Badge';
import Pagination from './Pagination';
import { fmtDate } from '../utils/format';

const SOURCES = [
  { id: '', label: 'Tout' },
  { id: 'member', label: 'Membre' },
  { id: 'staff', label: 'Staff' },
  { id: 'notes', label: 'Notes internes' },
];
const SOURCE_LABEL = { user: 'Membre', reply: 'Réponse', scheduled: 'Message programmé', discord: 'Discord', web: 'Note interne' };

const norm = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

// Wraps every occurrence of the searched words (accent/case-insensitive, prefix) in <mark>
function Highlight({ text, terms }) {
  if (!terms?.length) return text;
  const n = norm(text);
  const marks = [];
  for (const t of terms) {
    const w = norm(t);
    for (let i = n.indexOf(w); i >= 0 && w; i = n.indexOf(w, i + w.length)) marks.push([i, i + w.length]);
  }
  if (!marks.length) return text;
  marks.sort((a, b) => a[0] - b[0]);
  const out = [];
  let pos = 0;
  for (const [a, b] of marks) {
    if (a < pos) continue;
    out.push(text.slice(pos, a), <mark key={a} className="bg-amber-400/25 text-ink-1 rounded-sm">{text.slice(a, b)}</mark>);
    pos = b;
  }
  out.push(text.slice(pos));
  return out;
}

export default function MessageSearch({ q, status }) {
  const navigate = useNavigate();
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const query = q.trim();

  useEffect(() => { setPage(1); }, [query, source, status]);
  useEffect(() => {
    if (query.length < 2) { setData(null); setError(''); return; }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api.get('/tickets/search', { params: { q: query, source: source || undefined, status: status || undefined, page } })
        .then(r => { if (!cancelled) { setData(r.data); setError(''); } })
        .catch(e => { if (!cancelled) setError(e.response?.data?.error || 'Recherche impossible'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, source, status, page]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {SOURCES.map(s => (
          <button key={s.id} onClick={() => setSource(s.id)} aria-pressed={source === s.id}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                        ${source === s.id ? 'bg-primary/15 border-primary/40 text-primary-light' : 'bg-surface border-overlay/[0.07] text-ink-3 hover:text-ink-1'}`}>
            {s.label}
          </button>
        ))}
        <span className="text-xs text-ink-3 ml-auto flex items-center gap-1.5" aria-live="polite">
          {loading && <Loader2 size={12} className="animate-spin" />}
          {query.length < 2 ? 'Saisis au moins 2 caractères' : data && `${data.total} ticket(s) trouvé(s)`}
        </span>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {data && !data.results.length && !loading && (
        <div className="flex flex-col items-center py-14 gap-2 bg-surface-card border border-overlay/6 rounded-2xl">
          <Inbox size={20} className="text-ink-4" />
          <p className="text-sm text-ink-3">Aucun message ne contient « {query} »</p>
        </div>
      )}

      <ul className="space-y-2">
        {data?.results.map(({ ticket: t, hits, match }) => (
          <li key={t.id}>
            <button onClick={() => navigate(`/tickets/${t.id}${match ? `?note=${match.id}` : ''}`)}
              className="w-full text-left bg-surface-card border border-overlay/6 rounded-2xl p-4 shadow-card
                         hover:border-overlay/12 hover:bg-overlay/1.5 transition-all">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-ink-4 tabular-nums">#{t.id}</span>
                <span className="text-ink-1 font-medium"><Highlight text={t.owner_tag} terms={data.terms} /></span>
                <span className="text-ink-2 truncate min-w-0 flex-1"><Highlight text={t.subject || '—'} terms={data.terms} /></span>
                <Badge label={t.status} variant={t.status} />
              </div>
              {match ? (
                <div className="mt-2.5 flex gap-2.5">
                  <MessageSquare size={13} className="text-ink-4 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-ink-2 leading-relaxed wrap-break-word"><Highlight text={match.snippet} terms={data.terms} /></p>
                    <p className="text-[11px] text-ink-4 mt-1">
                      {SOURCE_LABEL[match.source] || match.source} · {match.author_tag} · {fmtDate(match.created_at)}
                      {hits > 1 && <span> · {hits} messages correspondent</span>}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-ink-4 mt-2">Trouvé dans le sujet ou le pseudo</p>
              )}
            </button>
          </li>
        ))}
      </ul>

      {data && <Pagination page={page} pages={data.pages} onChange={setPage} />}
    </div>
  );
}
