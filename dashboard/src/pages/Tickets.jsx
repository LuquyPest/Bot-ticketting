import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Download, Inbox, CheckSquare, Square, X, Lock,
  ChevronDown, Calendar, AlertTriangle, Tag as TagIcon,
  FolderOpen, FileText, User,
} from 'lucide-react';
import api from '../api';
import Badge from '../components/Badge';
import Pagination from '../components/Pagination';
import Select from '../components/Select';
import { SkeletonTableRows } from '../components/Skeleton';
import { fmtDate } from '../utils/format';
import { confirmToast } from '../utils/confirmToast';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useAuth } from '../App';
import { useSSE } from '../hooks/useSSE';
import toast from 'react-hot-toast';

/* ── Quick-filter pills config ────────────────────────────────── */
const QUICK_FILTERS = [
  { id: 'all',       label: 'Tous',      filter: {} },
  { id: 'open',      label: 'Ouverts',   filter: { status: 'open' } },
  { id: 'closed',    label: 'Fermés',    filter: { status: 'closed' } },
  { id: 'urgent',    label: 'Urgent',    filter: { priority: 'urgent' }, dot: 'bg-red-400' },
  { id: 'normal',    label: 'Normal',    filter: { priority: 'normal' }, dot: 'bg-amber-400' },
  { id: 'low',       label: 'Faible',    filter: { priority: 'low' }, dot: 'bg-sky-400' },
  { id: 'unclaimed', label: 'Non claim', filter: { claimed: 'false' } },
  { id: 'claimed',   label: 'Claim',     filter: { claimed: 'true' } },
];

/* ── Quick-view overlay ──────────────────────────────────────── */
function QuickView({ ticket, onClose }) {
  useEffect(() => {
    function handler(e) {
      if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!ticket) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-surface-card border border-white/[0.1] rounded-2xl p-6
                   shadow-[0_24px_80px_rgba(0,0,0,0.8)] w-full max-w-md animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-ink-4 hover:text-ink-2 transition-colors">
          <X size={15} />
        </button>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <FileText size={15} className="text-primary-light" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-ink-4 font-mono">Ticket #{ticket.id}</p>
            <p className="text-sm font-semibold text-ink-1 mt-0.5 truncate">
              {ticket.subject || <span className="italic text-ink-4">Sans sujet</span>}
            </p>
          </div>
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
            <span className="text-ink-4 flex items-center gap-1.5"><User size={11} /> Utilisateur</span>
            <span className="text-ink-2 font-medium">{ticket.owner_tag}</span>
          </div>
          <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
            <span className="text-ink-4">Statut</span>
            <Badge label={ticket.status} variant={ticket.status} />
          </div>
          <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
            <span className="text-ink-4">Priorité</span>
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[ticket.priority] || 'bg-ink-4'}`} />
              {PRIORITY_LABELS[ticket.priority] || ticket.priority}
            </span>
          </div>
          {ticket.claimed_by_tag && (
            <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
              <span className="text-ink-4">Assigné à</span>
              <span className="text-ink-2">{ticket.claimed_by_tag}</span>
            </div>
          )}
          <div className="flex items-center justify-between py-1.5">
            <span className="text-ink-4">Créé le</span>
            <span className="text-ink-3 tabular-nums">
              {fmtDate(ticket.created_at, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
        <div className="mt-5 pt-4 border-t border-white/[0.06] flex items-center justify-between">
          <span className="text-[10px] text-ink-4">Espace / Échap pour fermer</span>
          <button onClick={onClose} className="text-xs text-primary-light hover:text-ink-1 font-medium transition-colors">
            Ouvrir le ticket →
          </button>
        </div>
      </div>
    </div>
  );
}

const PRIORITY_DOT = {
  low:    'bg-sky-400',
  normal: 'bg-amber-400',
  urgent: 'bg-red-400',
};
const PRIORITY_LABELS = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };

function slaInfo(lastMessageAt, createdAt, status) {
  if (status !== 'open') return null;
  const base = lastMessageAt || createdAt;
  if (!base) return null;
  const hours = (Date.now() - new Date(base).getTime()) / 3600000;
  if (hours < 4)  return null;
  if (hours < 24) return { label: `${Math.floor(hours)}h`, cls: 'text-amber-400', icon: true };
  const days = Math.floor(hours / 24);
  return {
    label: `${days}j`,
    cls: days >= 3 ? 'text-red-400' : 'text-amber-400',
    urgent: days >= 3,
  };
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

  const [data, setData]   = useState({ tickets: [], total: 0, pages: 1 });
  const [page, setPage]   = useState(1);
  const [filters, setFilters] = useState({ status: '', priority: '', subject: '', dateFrom: '', dateTo: '', claimed: '', staffId: '' });
  const [activeQuick, setActiveQuick] = useState('all');
  const [quickView, setQuickView] = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkPriority, setShowBulkPriority] = useState(false);
  const [showBulkStaff,    setShowBulkStaff]    = useState(false);
  const [showBulkTag,      setShowBulkTag]       = useState(false);
  const [showBulkTemplate, setShowBulkTemplate] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showDateFilter,   setShowDateFilter]   = useState(false);
  const [showStaffFilter,  setShowStaffFilter]  = useState(false);
  const [staffList,  setStaffList]  = useState([]);
  const [tagList,    setTagList]    = useState([]);
  const [focusedRow, setFocusedRow] = useState(-1);

  const searchRef  = useRef(null);
  const tableRef   = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page,
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      };
      const { data: res } = await api.get('/tickets', { params });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(new Set()); setFocusedRow(-1); }, [page, filters]);
  useAutoRefresh(load);

  /* Load staff + tags + templates */
  useEffect(() => {
    api.get('/staff').then(r => setStaffList(r.data)).catch(() => {});
    api.get('/tags').then(r => setTagList(r.data)).catch(() => {});
    api.get('/templates').then(r => setTemplates(r.data)).catch(() => {});
  }, []);

  useSSE({
    ticket: (d) => {
      setData(prev => ({
        ...prev,
        tickets: prev.tickets.map(t => t.id === d.id ? { ...t, ...d } : t),
      }));
    },
    new_ticket: () => {
      if (page === 1 && !filters.status && !filters.priority && !filters.subject) load();
    },
  });

  const setFilter = (key, val) => {
    setFilters(f => ({ ...f, [key]: val }));
    setPage(1);
  };

  const applyQuick = (qf) => {
    setActiveQuick(qf.id);
    setFilters(f => ({
      ...f,
      status:   qf.filter.status   ?? '',
      priority: qf.filter.priority ?? '',
      claimed:  qf.filter.claimed  ?? '',
    }));
    setPage(1);
  };

  const allIds      = data.tickets.map(t => t.id);
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
      const label = { close: 'fermé(s)', reopen: 'réouvert(s)', send_template: 'envoyé(s)' }[action] || 'mis à jour';
      toast.success(`${r.affected} ticket(s) ${label}`);
      setSelected(new Set());
      setShowBulkPriority(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setBulkLoading(false);
    }
  };

  /* ── keyboard navigation ──────────────────────────────────── */
  useEffect(() => {
    function handler(e) {
      // Don't capture when typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      if (e.key === ' ' && focusedRow >= 0) {
        e.preventDefault();
        const t = data.tickets[focusedRow];
        if (t) setQuickView(qv => qv?.id === t.id ? null : t);
        return;
      }
      if (e.key === '/' || e.key === 's') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedRow(r => Math.min(r + 1, data.tickets.length - 1));
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedRow(r => Math.max(r - 1, 0));
        return;
      }
      if (e.key === 'Enter' && focusedRow >= 0) {
        e.preventDefault();
        const t = data.tickets[focusedRow];
        if (t) navigate(`/tickets/${t.id}`);
        return;
      }
      if (e.key === 'Escape') {
        setFocusedRow(-1);
        setSelected(new Set());
        setQuickView(null);
        return;
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [data.tickets, focusedRow, navigate]);

  const colCount = user?.role === 'fondateur' ? 10 : 9;

  const hasDateFilter = filters.dateFrom || filters.dateTo;

  return (
    <div className="p-6 space-y-5 pb-24">

      {quickView && <QuickView ticket={quickView} onClose={() => setQuickView(null)} />}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="page-header">
          <h1>Tickets</h1>
          <p>{data.total} ticket(s) trouvé(s)</p>
        </div>
        {user?.role === 'fondateur' && (
          <a
            href="/api/tickets/export"
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface border border-white/[0.07]
                       text-ink-3 hover:text-ink-1 hover:border-white/[0.12] text-xs font-medium
                       transition-all duration-150"
          >
            <Download size={13} /> Export CSV
          </a>
        )}
      </div>

      {/* Quick-filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {QUICK_FILTERS.map(qf => {
          const isActive = activeQuick === qf.id;
          return (
            <button
              key={qf.id}
              onClick={() => applyQuick(qf)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                          border transition-all duration-150 select-none
                          ${isActive
                            ? 'bg-primary/15 text-primary-light border-primary/40 shadow-[0_0_12px_rgba(124,110,243,0.15)]'
                            : 'bg-surface border-white/[0.07] text-ink-3 hover:text-ink-1 hover:border-white/[0.12]'}`}
            >
              {qf.dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${qf.dot}`} />}
              {qf.label}
            </button>
          );
        })}
      </div>

      {/* Keyboard hint */}
      <div className="flex items-center gap-3 text-[10px] text-ink-4">
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded bg-surface border border-white/[0.08] font-mono">J/K</kbd>
          <span>naviguer</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded bg-surface border border-white/[0.08] font-mono">↵</kbd>
          <span>ouvrir</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded bg-surface border border-white/[0.08] font-mono">Espace</kbd>
          <span>aperçu</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded bg-surface border border-white/[0.08] font-mono">/</kbd>
          <span>rechercher</span>
        </span>
      </div>

      {/* Filters row 1 */}
      <div className="flex flex-wrap gap-2.5">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Rechercher par sujet... (/)"
            value={filters.subject}
            onChange={e => setFilter('subject', e.target.value)}
            className="w-full bg-surface border border-white/[0.07] text-ink-1 placeholder-ink-4
                       rounded-xl pl-9 pr-3.5 py-2 text-sm
                       focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       hover:border-white/[0.12] transition-all duration-150"
          />
        </div>
        <Select
          className="w-40"
          value={filters.status}
          onChange={v => { setFilter('status', v); setActiveQuick(''); }}
          placeholder="Tous statuts"
          options={[
            { value: '', label: 'Tous statuts' },
            { value: 'open',   label: 'Ouvert' },
            { value: 'closed', label: 'Fermé' },
          ]}
        />
        <Select
          className="w-44"
          value={filters.priority}
          onChange={v => { setFilter('priority', v); setActiveQuick(''); }}
          placeholder="Toutes priorités"
          options={[
            { value: '',       label: 'Toutes priorités' },
            { value: 'low',    label: 'Faible' },
            { value: 'normal', label: 'Normal' },
            { value: 'urgent', label: 'Urgent' },
          ]}
        />
        {/* Staff filter */}
        {staffList.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowStaffFilter(o => !o)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium
                          border transition-all duration-150
                          ${filters.staffId
                            ? 'bg-primary/10 text-primary-light border-primary/30'
                            : 'bg-surface border-white/[0.07] text-ink-3 hover:text-ink-1 hover:border-white/[0.12]'}`}
            >
              <User size={13} />
              {filters.staffId
                ? (staffList.find(s => s.admin_id === filters.staffId)?.admin_tag || 'Staff')
                : 'Staff'}
              {filters.staffId ? (
                <span onClick={e => { e.stopPropagation(); setFilter('staffId', ''); setShowStaffFilter(false); }}
                  className="ml-1 hover:text-ink-1 cursor-pointer">
                  <X size={11} />
                </span>
              ) : (
                <ChevronDown size={11} className={showStaffFilter ? 'rotate-180 transition-transform' : 'transition-transform'} />
              )}
            </button>
            {showStaffFilter && (
              <div className="absolute top-full mt-1 left-0 bg-surface-elevated border border-white/[0.1]
                              rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden min-w-44
                              max-h-52 overflow-y-auto z-20">
                <button
                  onClick={() => { setFilter('staffId', ''); setShowStaffFilter(false); }}
                  className="w-full flex items-center px-3.5 py-2.5 text-xs text-ink-3 hover:bg-white/[0.05] transition-colors"
                >
                  Tous les staff
                </button>
                {staffList.map(s => (
                  <button
                    key={s.admin_id}
                    onClick={() => { setFilter('staffId', s.admin_id); setShowStaffFilter(false); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs text-ink-2
                               hover:bg-white/[0.05] hover:text-ink-1 transition-colors"
                  >
                    {s.admin_tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Date filter toggle */}
        <button
          onClick={() => setShowDateFilter(o => !o)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium
                      border transition-all duration-150
                      ${(showDateFilter || hasDateFilter)
                        ? 'bg-primary/10 text-primary-light border-primary/30'
                        : 'bg-surface border-white/[0.07] text-ink-3 hover:text-ink-1 hover:border-white/[0.12]'}`}
        >
          <Calendar size={13} />
          Date
          {hasDateFilter && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary-light ml-0.5" />
          )}
        </button>
      </div>

      {/* Date range row */}
      {showDateFilter && (
        <div className="flex items-center gap-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-3 flex-shrink-0">Du</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={e => setFilter('dateFrom', e.target.value)}
              className="bg-surface border border-white/[0.07] text-ink-1 rounded-xl px-3 py-2 text-xs
                         focus:outline-none focus:border-primary/50 transition-all
                         [color-scheme:dark]"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-3 flex-shrink-0">Au</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={e => setFilter('dateTo', e.target.value)}
              className="bg-surface border border-white/[0.07] text-ink-1 rounded-xl px-3 py-2 text-xs
                         focus:outline-none focus:border-primary/50 transition-all
                         [color-scheme:dark]"
            />
          </div>
          {hasDateFilter && (
            <button
              onClick={() => { setFilter('dateFrom', ''); setFilter('dateTo', ''); }}
              className="flex items-center gap-1 text-xs text-ink-4 hover:text-ink-2 transition-colors"
            >
              <X size={12} /> Effacer
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div
        ref={tableRef}
        className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden shadow-card"
      >
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
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Assigné à</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Créé le</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Fermé par</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonTableRows rows={8} cols={colCount} />
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
            ) : data.tickets.map((t, rowIdx) => {
              const sla       = slaInfo(t.last_message_at, t.created_at, t.status);
              const unread    = t.status === 'open' && isUnread(t.id, t.last_message_at);
              const isSelected = selected.has(t.id);
              const isFocused  = focusedRow === rowIdx;

              return (
                <tr
                  key={t.id}
                  onClick={() => navigate(`/tickets/${t.id}`)}
                  onMouseEnter={() => setFocusedRow(rowIdx)}
                  className={`
                    border-b border-white/[0.04] last:border-0 cursor-pointer transition-colors
                    ${t.priority === 'urgent' ? 'border-l-2 border-l-red-500/50' : ''}
                    ${isSelected  ? 'bg-primary/5' : ''}
                    ${isFocused && !isSelected ? 'bg-white/[0.025]' : ''}
                    ${!isFocused && !isSelected ? 'hover:bg-white/[0.015]' : ''}
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
                    {/* Tags */}
                    {t.tags && t.tags.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mt-1">
                        {t.tags.slice(0, 3).map(tag => (
                          <span
                            key={tag.id}
                            onClick={e => e.stopPropagation()}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border"
                            style={{ backgroundColor: `${tag.color}18`, color: tag.color, borderColor: `${tag.color}35` }}
                          >
                            <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                            {tag.name}
                          </span>
                        ))}
                        {t.tags.length > 3 && (
                          <span className="text-[10px] text-ink-4">+{t.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                    {/* SLA indicator */}
                    {sla && (
                      <div className={`flex items-center gap-1 text-[10px] mt-0.5 font-semibold ${sla.cls}`}>
                        {sla.urgent && <AlertTriangle size={9} />}
                        {sla.label} sans réponse
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
                  <td className="px-4 py-3.5 text-xs truncate max-w-[120px]">
                    {t.claimed_by_tag
                      ? <span className="text-emerald-400 font-medium">{t.claimed_by_tag}</span>
                      : <span className="text-ink-4 italic">—</span>}
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

          {/* Priority */}
          <div className="relative">
            <button
              onClick={() => { setShowBulkPriority(p => !p); setShowBulkStaff(false); setShowBulkTag(false); }}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-white/[0.08]
                         text-ink-2 text-xs font-medium hover:bg-surface-hover hover:text-ink-1
                         transition-all disabled:opacity-50"
            >
              Priorité
              <ChevronDown size={11} className={showBulkPriority ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>
            {showBulkPriority && (
              <div className="absolute bottom-full mb-2 left-0 bg-surface-elevated border border-white/[0.1]
                              rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden min-w-36 animate-in">
                {[['low','Faible','text-sky-400'],['normal','Normal','text-amber-400'],['urgent','Urgent','text-red-400']].map(([val, label, cls]) => (
                  <button
                    key={val}
                    onClick={() => { bulkAction('priority', val); setShowBulkPriority(false); }}
                    className={`w-full flex items-center gap-2 px-3.5 py-2.5 text-xs
                                hover:bg-white/[0.05] transition-colors ${cls}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Assign staff */}
          {staffList.length > 0 && (
            <div className="relative">
              <button
                onClick={() => { setShowBulkStaff(p => !p); setShowBulkPriority(false); setShowBulkTag(false); }}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-white/[0.08]
                           text-ink-2 text-xs font-medium hover:bg-surface-hover hover:text-ink-1
                           transition-all disabled:opacity-50"
              >
                Assigner
                <ChevronDown size={11} className={showBulkStaff ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {showBulkStaff && (
                <div className="absolute bottom-full mb-2 left-0 bg-surface-elevated border border-white/[0.1]
                                rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden min-w-44
                                max-h-48 overflow-y-auto animate-in">
                  {staffList.map(s => (
                    <button
                      key={s.admin_id}
                      onClick={() => { bulkAction('assign', s.admin_id); setShowBulkStaff(false); }}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs text-ink-2
                                 hover:bg-white/[0.05] hover:text-ink-1 transition-colors"
                    >
                      {s.admin_tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add tag */}
          {tagList.length > 0 && (
            <div className="relative">
              <button
                onClick={() => { setShowBulkTag(p => !p); setShowBulkPriority(false); setShowBulkStaff(false); }}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-white/[0.08]
                           text-ink-2 text-xs font-medium hover:bg-surface-hover hover:text-ink-1
                           transition-all disabled:opacity-50"
              >
                Tag
                <ChevronDown size={11} className={showBulkTag ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {showBulkTag && (
                <div className="absolute bottom-full mb-2 left-0 bg-surface-elevated border border-white/[0.1]
                                rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden min-w-40
                                max-h-48 overflow-y-auto animate-in">
                  {tagList.map(t => (
                    <button
                      key={t.id}
                      onClick={() => { bulkAction('add_tag', t.id); setShowBulkTag(false); }}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs hover:bg-white/[0.05] transition-colors"
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: t.color || '#7c6ef3' }}
                      />
                      <span className="text-ink-2 hover:text-ink-1">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}


          {/* Send template */}
          {templates.length > 0 && (
            <div className="relative">
              <button
                onClick={() => { setShowBulkTemplate(p => !p); setShowBulkPriority(false); setShowBulkStaff(false); setShowBulkTag(false); }}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-white/[0.08]
                           text-ink-2 text-xs font-medium hover:bg-surface-hover hover:text-ink-1
                           transition-all disabled:opacity-50"
              >
                <FileText size={11} /> Réponse
                <ChevronDown size={11} className={showBulkTemplate ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {showBulkTemplate && (
                <div className="absolute bottom-full mb-2 left-0 bg-surface-elevated border border-white/[0.1]
                                rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden min-w-48
                                max-h-56 overflow-y-auto animate-in">
                  <p className="px-3.5 pt-2.5 pb-1 text-[10px] text-ink-4 uppercase tracking-wider font-semibold">
                    Envoyer un template
                  </p>
                  {templates.map(tpl => (
                    <button
                      key={tpl.id}
                      onClick={async () => {
                        const ok = await confirmToast(`Envoyer "${tpl.name}" à ${selected.size} ticket(s) ?`);
                        if (ok) { bulkAction('send_template', tpl.id); setShowBulkTemplate(false); }
                      }}
                      className="w-full flex items-start gap-2 px-3.5 py-2.5 text-xs
                                 hover:bg-white/[0.05] transition-colors text-left"
                    >
                      <FileText size={11} className="text-primary-light mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-ink-2 font-medium truncate">{tpl.name}</p>
                        <p className="text-ink-4 truncate mt-0.5">{tpl.content?.slice(0, 40)}…</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reopen */}
          <button
            onClick={async () => {
              const ok = await confirmToast(`Réouvrir ${selected.size} ticket(s) ?`);
              if (ok) bulkAction('reopen');
            }}
            disabled={bulkLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20
                       text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-50"
          >
            <FolderOpen size={11} /> Réouvrir
          </button>

          {/* Close */}
          <button
            onClick={async () => {
              const ok = await confirmToast(`Fermer ${selected.size} ticket(s) ?`);
              if (ok) bulkAction('close');
            }}
            disabled={bulkLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20
                       text-red-400 text-xs font-medium hover:bg-red-500/20 transition-all disabled:opacity-50"
          >
            <Lock size={11} /> Fermer
          </button>

          {/* Clear */}
          <button
            onClick={() => { setSelected(new Set()); setShowBulkPriority(false); }}
            className="text-ink-4 hover:text-ink-2 transition-colors p-1"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
