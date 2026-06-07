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
  urgent: 'bg-red-400'
};
const PRIORITY_LABELS = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };

function ticketAge(lastMessageAt, createdAt) {
  const base = lastMessageAt || createdAt;
  if (!base) return null;
  const diffMs = Date.now() - new Date(base).getTime();
  const hours = diffMs / 3600000;
  if (hours < 1) return null;
  if (hours < 24) return { label: `${Math.floor(hours)}h`, cls: 'text-amber-500' };
  const days = Math.floor(hours / 24);
  return { label: `${days}j`, cls: days >= 3 ? 'text-red-500' : 'text-amber-500' };
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
  const [bulkPriority, setBulkPriority] = useState('');
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

  return (
    <div className="p-6 space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Tickets</h1>
          <p className="text-sm text-slate-500 mt-0.5">{data.total} ticket(s) trouvé(s)</p>
        </div>
        {user?.role === 'fondateur' && (
          <a href="/api/tickets/export"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700/60 text-slate-400 hover:text-slate-100 hover:bg-slate-700 text-xs font-medium transition-colors">
            <Download size={13} /> Export CSV
          </a>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
          <input type="text" placeholder="Rechercher par sujet..." value={filters.subject}
            onChange={e => setFilter('subject', e.target.value)}
            className="w-full bg-slate-800/50 border border-slate-700/60 text-slate-300 placeholder-slate-600 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500/60 hover:border-slate-500/60 transition-colors"
          />
        </div>
        <Select className="w-40" value={filters.status} onChange={v => setFilter('status', v)} placeholder="Tous statuts"
          options={[{ value: '', label: 'Tous statuts' }, { value: 'open', label: 'Ouvert' }, { value: 'closed', label: 'Fermé' }]} />
        <Select className="w-44" value={filters.priority} onChange={v => setFilter('priority', v)} placeholder="Toutes priorités"
          options={[{ value: '', label: 'Toutes priorités' }, { value: 'low', label: 'Faible' }, { value: 'normal', label: 'Normal' }, { value: 'urgent', label: 'Urgent' }]} />
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800/60 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800/60">
              {user?.role === 'fondateur' && (
                <th className="px-3 py-3 w-10 text-left">
                  <button onClick={toggleAll} className="text-slate-500 hover:text-slate-300 transition-colors">
                    {allSelected ? <CheckSquare size={15} className="text-indigo-400" /> : <Square size={15} />}
                  </button>
                </th>
              )}
              <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider w-5"></th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">ID</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Utilisateur</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Sujet</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Statut</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Priorité</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Créé le</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Fermé par</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={user?.role === 'fondateur' ? 9 : 8} className="text-center py-12 text-slate-600 text-sm">Chargement...</td></tr>
            ) : !data.tickets.length ? (
              <tr><td colSpan={user?.role === 'fondateur' ? 9 : 8}>
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
                    <Inbox size={22} className="text-slate-600" />
                  </div>
                  <p className="text-sm text-slate-600 font-medium">Aucun ticket trouvé</p>
                  <p className="text-xs text-slate-700">Modifiez vos filtres ou attendez de nouveaux tickets.</p>
                </div>
              </td></tr>
            ) : data.tickets.map(t => {
              const age = t.status === 'open' ? ticketAge(t.last_message_at, t.created_at) : null;
              const unread = t.status === 'open' && isUnread(t.id, t.last_message_at);
              const isSelected = selected.has(t.id);
              return (
                <tr key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}
                  className={`border-b border-slate-800/40 hover:bg-slate-800/60 cursor-pointer transition-colors last:border-0 ${t.priority === 'urgent' ? 'border-l-2 border-l-red-500/50' : ''} ${isSelected ? 'bg-indigo-600/5' : ''}`}>
                  {user?.role === 'fondateur' && (
                    <td className="px-3 py-3" onClick={e => toggleOne(t.id, e)}>
                      <button className="text-slate-600 hover:text-indigo-400 transition-colors">
                        {isSelected ? <CheckSquare size={14} className="text-indigo-400" /> : <Square size={14} />}
                      </button>
                    </td>
                  )}
                  <td className="px-3 py-3">
                    {unread && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 block mx-auto" title="Nouveau message" />}
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-xs">#{t.id}</td>
                  <td className="px-4 py-3 text-slate-200 font-medium">{t.owner_tag}</td>
                  <td className="px-4 py-3 text-slate-400 max-w-xs">
                    <div className="truncate">{t.subject || <span className="italic text-slate-700">—</span>}</div>
                    {age && <div className={`text-[10px] mt-0.5 font-medium ${age.cls}`}>{age.label} sans réponse</div>}
                  </td>
                  <td className="px-4 py-3"><Badge label={t.status} variant={t.status} /></td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || 'bg-slate-600'}`} />
                      {PRIORITY_LABELS[t.priority] || t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                    {fmtDate(t.created_at, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-xs">{t.closed_by_tag || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pages={data.pages} onChange={setPage} />

      {/* Bulk action bar */}
      {someSelected && user?.role === 'fondateur' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl px-4 py-3">
          <span className="text-sm font-semibold text-slate-200">{selected.size} sélectionné(s)</span>
          <div className="w-px h-4 bg-slate-700" />

          {/* Priority change */}
          <div className="relative">
            <button onClick={() => setShowBulkPriority(p => !p)} disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-50">
              Changer priorité <ChevronDown size={12} />
            </button>
            {showBulkPriority && (
              <div className="absolute bottom-full mb-2 left-0 bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden min-w-36">
                {[['low','🔵 Faible'],['normal','🟡 Normal'],['urgent','🔴 Urgent']].map(([val, label]) => (
                  <button key={val} onClick={() => bulkAction('priority', val)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 transition-colors">
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Close */}
          <button onClick={() => { if (confirm(`Fermer ${selected.size} ticket(s) ?`)) bulkAction('close'); }} disabled={bulkLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-600/30 text-red-400 text-xs font-medium hover:bg-red-600/30 transition-colors disabled:opacity-50">
            <Lock size={12} /> Fermer
          </button>

          {/* Clear */}
          <button onClick={() => { setSelected(new Set()); setShowBulkPriority(false); }}
            className="text-slate-600 hover:text-slate-300 transition-colors p-1">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
