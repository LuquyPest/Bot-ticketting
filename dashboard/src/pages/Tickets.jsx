import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Download, Inbox, CheckSquare, Square, X, Lock, ChevronDown } from 'lucide-react';
import api from '../api';
import Badge from '../components/Badge';
import Pagination from '../components/Pagination';
import Select from '../components/Select';
import { fmtDate } from '../utils/format';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useAuth } from '../App';
import { useSSE } from '../hooks/useSSE';
import toast from 'react-hot-toast';

const PRIORITY_DOT = {
  low:    'bg-sky-400',
  normal: 'bg-amber-400',
  urgent: 'bg-red-400',
};
const PRIORITY_LABELS = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };

function ticketAge(lastMessageAt, createdAt) {
  const base = lastMessageAt || createdAt;
  if (!base) return null;
  const hours = (Date.now() - new Date(base).getTime()) / 3600000;
  if (hours < 1) return null;
  if (hours < 24) return { label: `${Math.floor(hours)}h`, cls: 'text-amber-400' };
  const days = Math.floor(hours / 24);
  return { label: `${days}j`, cls: days >= 3 ? 'text-red-400' : 'text-amber-400' };
}

function isUnread(ticketId, lastMessageAt) {
  if (!lastMessageAt) return false;
  const seen = localStorage.getItem(`ticket_seen_${ticketId}`);
  if (!seen) return true;
  return new Date(lastMessageAt).getTime() > parseInt(seen, 10);
}

export default function Tickets() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState({ tickets: [], total: 0, pages: 1 });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: '', priority: '', subject: '' });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkPriority, setShowBulkPriority] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
      const { data: res } = await api.get('/tickets', { params });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(new Set()); }, [page, filters]);
  useAutoRefresh(load);

  useSSE({
    ticket: (d) => {
      setData(prev => ({ ...prev, tickets: prev.tickets.map(t => t.id === d.id ? { ...t, ...d } : t) }));
    },
    new_ticket: () => {
      if (page === 1 && !filters.status && !filters.priority && !filters.subject) load();
    }
  });

  const setFilter = (key, val) => { setFilters(f => ({ ...f, [key]: val })); setPage(1); };

  const allIds = data.tickets.map(t => t.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => { const s = new Set(prev); allIds.forEach(id => s.delete(id)); return s; });
    } else {
      setSelected(prev => new Set([...prev, ...allIds]));
    }
  };

  const toggleOne = (id, e) => {
    e.stopPropagation();
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const bulkAction = async (action, value) => {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkLoading(true);
    try {
      const { data: r } = await api.post('/tickets/bulk', { ids, action, value });
      toast.success(`${r.affected} ticket(s) ${action === 'close' ? 'fermé(s)' : 'mis à jour'}`);
      setSelected(new Set());
      setShowBulkPriority(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setBulkLoading(false);
    }
  };

  const colCount = user?.role === 'fondateur' ? 9 : 8;

  return (
    <div className="p-6 space-y-5 pb-24">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="page-header">
          <h1>Tickets</h1>
          <p>{data.total} ticket(s) trouvé(s)</p>
        </div>
        {user?.role === 'fondateur' && (
          <a href="/api/tickets/export"
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface border border-white/[0.07]
                       text-ink-3 hover:text-ink-1 hover:border-white/[0.12] text-xs font-medium
                       transition-all duration-150">
            <Download size={13} /> Export CSV
          </a>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
          <input type="text" placeholder="Rechercher par sujet..." value={filters.subject}
            onChange={e => setFilter('subject', e.target.value)}
            className="w-full bg-surface border border-white/[0.07] text-ink-1 placeholder-ink-4
                       rounded-xl pl-9 pr-3.5 py-2 text-sm
                       focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       hover:border-white/[0.12] transition-all duration-150"
          />
        </div>
        <Select className="w-40" value={filters.status} onChange={v => setFilter('status', v)}
          placeholder="Tous statuts"
          options={[
            { value: '', label: 'Tous statuts' },
            { value: 'open',   label: 'Ouvert' },
            { value: 'closed', label: 'Fermé' },
          ]} />
        <Select className="w-44" value={filters.priority} onChange={v => setFilter('priority', v)}
          placeholder="Toutes priorités"
          options={[
            { value: '',       label: 'Toutes priorités' },
            { value: 'low',    label: 'Faible' },
            { value: 'normal', label: 'Normal' },
            { value: 'urgent', label: 'Urgent' },
          ]} />
      </div>

      {/* Table */}
      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {user?.role === 'fondateur' && (
                <th className="px-3.5 py-3.5 w-10 text-left">
                  <button onClick={toggleAll} className="text-ink-4 hover:text-ink-2 transition-colors">
                    {allSelected
                      ? <CheckSquare size={14} className="text-primary-light" />
                      : <Square size={14} />}
                  </button>
                </th>
              )}
              <th className="px-3 py-3.5 w-5" />
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">ID</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Utilisateur</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Sujet</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Statut</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Priorité</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Créé le</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Fermé par</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount} className="text-center py-12 text-ink-4 text-sm">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
                    Chargement...
                  </div>
                </td>
              </tr>
            ) : !data.tickets.length ? (
              <tr>
                <td colSpan={colCount}>
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-surface flex items-center justify-center
                                    border border-white/[0.06]">
                      <Inbox size={20} className="text-ink-4" />
                    </div>
                    <p className="text-sm text-ink-3 font-medium">Aucun ticket trouvé</p>
                    <p className="text-xs text-ink-4">Modifiez vos filtres ou attendez de nouveaux tickets.</p>
                  </div>
                </td>
              </tr>
            ) : data.tickets.map(t => {
              const age = t.status === 'open' ? ticketAge(t.last_message_at, t.created_at) : null;
              const unread = t.status === 'open' && isUnread(t.id, t.last_message_at);
              const isSelected = selected.has(t.id);
              return (
                <tr key={t.id}
                  onClick={() => navigate(`/tickets/${t.id}`)}
                  className={`
                    border-b border-white/[0.04] last:border-0 cursor-pointer transition-colors
                    ${t.priority === 'urgent' ? 'border-l-2 border-l-red-500/50' : ''}
                    ${isSelected ? 'bg-primary/5' : 'hover:bg-white/[0.025]'}
                  `}
                >
                  {user?.role === 'fondateur' && (
                    <td className="px-3.5 py-3.5" onClick={e => toggleOne(t.id, e)}>
                      <button className="text-ink-4 hover:text-primary-light transition-colors">
                        {isSelected
                          ? <CheckSquare size={13} className="text-primary-light" />
                          : <Square size={13} />}
                      </button>
                    </td>
                  )}
                  <td className="px-3 py-3.5">
                    {unread && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-light block mx-auto
                                       shadow-[0_0_6px_rgba(167,139,250,0.8)]" title="Nouveau message" />
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-ink-4 font-mono text-xs tabular-nums">#{t.id}</td>
                  <td className="px-4 py-3.5 text-ink-1 font-medium">{t.owner_tag}</td>
                  <td className="px-4 py-3.5 text-ink-2 max-w-xs">
                    <div className="truncate">{t.subject || <span className="italic text-ink-4">—</span>}</div>
                    {age && (
                      <div className={`text-[10px] mt-0.5 font-semibold ${age.cls}`}>
                        {age.label} sans réponse
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5"><Badge label={t.status} variant={t.status} /></td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || 'bg-ink-4'}`} />
                      {PRIORITY_LABELS[t.priority] || t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-ink-3 text-xs whitespace-nowrap tabular-nums">
                    {fmtDate(t.created_at, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3.5 text-ink-3 text-xs truncate max-w-xs">{t.closed_by_tag || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pages={data.pages} onChange={setPage} />

      {/* Bulk action bar */}
      {someSelected && user?.role === 'fondateur' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-slide-up
                        flex items-center gap-3 bg-surface-elevated border border-white/[0.1]
                        rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.7)] px-4 py-3">
          <span className="text-sm font-semibold text-ink-1 tabular-nums">
            {selected.size} sélectionné(s)
          </span>
          <div className="w-px h-4 bg-white/[0.08]" />

          {/* Priority change */}
          <div className="relative">
            <button onClick={() => setShowBulkPriority(p => !p)} disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-white/[0.08]
                         text-ink-2 text-xs font-medium hover:bg-surface-hover hover:text-ink-1
                         transition-all disabled:opacity-50">
              Changer priorité <ChevronDown size={11} className={showBulkPriority ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>
            {showBulkPriority && (
              <div className="absolute bottom-full mb-2 left-0 bg-surface-elevated border border-white/[0.1]
                              rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden min-w-36 animate-in">
                {[['low','Faible','text-sky-400'],['normal','Normal','text-amber-400'],['urgent','Urgent','text-red-400']].map(([val, label, cls]) => (
                  <button key={val} onClick={() => bulkAction('priority', val)}
                    className={`w-full flex items-center gap-2 px-3.5 py-2.5 text-xs hover:bg-white/[0.05]
                                transition-colors ${cls}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Close */}
          <button
            onClick={() => { if (confirm(`Fermer ${selected.size} ticket(s) ?`)) bulkAction('close'); }}
            disabled={bulkLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20
                       text-red-400 text-xs font-medium hover:bg-red-500/20 transition-all disabled:opacity-50">
            <Lock size={11} /> Fermer
          </button>

          {/* Clear */}
          <button onClick={() => { setSelected(new Set()); setShowBulkPriority(false); }}
            className="text-ink-4 hover:text-ink-2 transition-colors p-1">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
