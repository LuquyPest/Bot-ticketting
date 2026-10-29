import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search, Download, Inbox, CheckSquare, Square, X, Lock,
  ChevronDown, Calendar, AlertTriangle,
  FolderOpen, FileText, User, Star, BookmarkPlus, PenLine, Eye, Megaphone,
} from 'lucide-react';
import { hasDraft } from '../hooks/useDraft';
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
import ContactMember from '../components/ContactMember';
import TicketDetail from './TicketDetail';
import SlaBadge from '../components/SlaBadge';
import MessageSearch from '../components/MessageSearch';

/* ── Quick-filter pills config ────────────────────────────────── */
const EMPTY_FILTERS = { status: '', priority: '', subject: '', stage: '', claimed: '', assignee: '', dateFrom: '', dateTo: '', tag: '', sla: '', field: '', fieldValue: '', following: '' };

// Operators of the search box (parsed by utils/searchQuery.js on the server)
const SEARCH_HELP = [
  ['tag:VIP', 'avec ce tag (tag:"Très urgent" si espaces)'], ['de:pseudo', 'ouverts par ce membre (pseudo ou ID)'],
  ['avant:2026-10-01', 'créés avant cette date'], ['après:01/10/2026', 'créés à partir de cette date'],
  ['étape:attente', 'ouvert, attente ou cours'], ['priorité:urgente', 'faible, normale ou urgente'],
  ['statut:fermé', 'ouvert ou fermé'], ['assigné:moi', 'moi, personne ou un pseudo du staff'], ['sujet:"mot de passe"', 'dans le sujet'],
];

/* ── Built-in views (the default one shows open tickets) ─────── */
const BUILTIN_VIEWS = [
  { id: 'open',        label: 'Ouverts',       filters: { status: 'open' } },
  { id: 'mine',        label: 'Mes tickets',   filters: { status: 'open', assignee: 'me' } },
  { id: 'unassigned',  label: 'Non attribués', filters: { status: 'open', claimed: 'false' } },
  { id: 'following',   label: 'Suivis',        filters: { following: 'me' } },
  { id: 'waiting',     label: 'En attente',    filters: { status: 'open', stage: 'waiting' } },
  { id: 'in_progress', label: 'En cours',      filters: { status: 'open', stage: 'in_progress' } },
  { id: 'urgent',      label: 'Urgents',       filters: { status: 'open', priority: 'urgent' }, dot: 'bg-red-400' },
  { id: 'sla',         label: 'Hors délai',    filters: { status: 'open', sla: 'breached' }, dot: 'bg-red-400' },
  { id: 'closed',      label: 'Fermés',        filters: { status: 'closed' } },
  { id: 'all',         label: 'Tous',          filters: {} },
];

const STAGE_LABELS = { open: 'Ouvert', waiting: 'En attente', in_progress: 'En cours' };
const STAGE_CLS = { open: 'text-sky-300', waiting: 'text-amber-300', in_progress: 'text-emerald-300' };
const assigneeNames = t => (t.assignees || []).map(a => a.username).join(', ');

/* ── Quick-view tooltip (apparaît après 1.5s de survol, suit la souris) ── */
const POPUP_W = 320;
const POPUP_H = 380;

const MSG_SOURCE_STYLE = {
  user:    { dot: 'bg-violet-400', label: 'text-violet-300' },
  reply:   { dot: 'bg-primary',    label: 'text-primary-light' },
  discord: { dot: 'bg-indigo-400', label: 'text-indigo-300' },
  note:    { dot: 'bg-amber-400',  label: 'text-amber-300' },
};

function QuickView({ ticket, x, y, messages }) {
  const left = x + 20 + POPUP_W > window.innerWidth  ? x - POPUP_W - 12 : x + 20;
  const top  = y + 20 + POPUP_H > window.innerHeight ? y - POPUP_H - 8  : y + 20;

  return createPortal(
    <div
      className="fixed z-50 w-[320px] bg-surface-elevated border border-overlay/12 rounded-2xl p-5
                 shadow-[0_16px_60px_rgba(0,0,0,0.8)] animate-fade-in pointer-events-none"
      style={{ left, top }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20
                        flex items-center justify-center shrink-0">
          <FileText size={13} className="text-primary-light" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] text-ink-4 font-mono">Ticket #{ticket.id}</p>
          <p className="text-sm font-semibold text-ink-1 mt-0.5 truncate">
            {ticket.subject || <span className="italic text-ink-4">Sans sujet</span>}
          </p>
        </div>
      </div>

      {/* Meta */}
      <div className="space-y-0 text-xs">
        <div className="flex items-center justify-between py-1.5 border-b border-overlay/4">
          <span className="text-ink-4 flex items-center gap-1.5"><User size={10} /> Utilisateur</span>
          <span className="text-ink-2 font-medium">{ticket.owner_tag}</span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-overlay/4">
          <span className="text-ink-4">Statut</span>
          <Badge label={ticket.status} variant={ticket.status} />
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-overlay/4">
          <span className="text-ink-4">Priorité</span>
          <span className="flex items-center gap-1.5 text-ink-2">
            <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[ticket.priority] || 'bg-ink-4'}`} />
            {PRIORITY_LABELS[ticket.priority] || ticket.priority}
          </span>
        </div>
        {ticket.status === 'open' && (
          <div className="flex items-center justify-between py-1.5 border-b border-overlay/4">
            <span className="text-ink-4">Étape</span>
            <span className={STAGE_CLS[ticket.stage] || 'text-ink-2'}>{STAGE_LABELS[ticket.stage] || '—'}</span>
          </div>
        )}
        {ticket.assignees?.length > 0 && (
          <div className="flex items-center justify-between gap-3 py-1.5 border-b border-overlay/4">
            <span className="text-ink-4 shrink-0">Attribué à</span>
            <span className="text-emerald-400 font-medium truncate">{assigneeNames(ticket)}</span>
          </div>
        )}
        <div className="flex items-center justify-between py-1.5">
          <span className="text-ink-4">Créé le</span>
          <span className="text-ink-3 tabular-nums">
            {fmtDate(ticket.created_at, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Last 2 messages */}
      <div className="mt-3 pt-3 border-t border-overlay/6">
        <p className="text-[10px] text-ink-4 uppercase tracking-wider font-semibold mb-2">
          Derniers messages
        </p>
        {!messages ? (
          <div className="space-y-2">
            {[0,1].map(i => (
              <div key={i} className="h-9 rounded-xl bg-surface shimmer" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="text-[11px] text-ink-4 italic">Aucun message</p>
        ) : (
          <div className="space-y-2">
            {messages.map((m, i) => {
              const s = MSG_SOURCE_STYLE[m.source] || MSG_SOURCE_STYLE.reply;
              return (
                <div key={i} className="bg-surface/60 border border-overlay/5 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                    <span className={`text-[10px] font-semibold truncate ${s.label}`}>
                      {m.author_tag || 'Système'}
                    </span>
                    <span className="text-[10px] text-ink-4 ml-auto shrink-0 tabular-nums">
                      {fmtDate(m.created_at, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-3 leading-snug line-clamp-2 wrap-break-word">
                    {m.content || <span className="italic text-ink-4">—</span>}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[10px] text-ink-4 mt-3">Cliquez pour ouvrir le ticket</p>
    </div>,
    document.body
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
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, status: 'open' });
  const [activeView, setActiveView] = useState('open'); // built-in id or `saved:<id>`
  const [savedViews, setSavedViews] = useState([]);
  const [quickView, setQuickView] = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkPriority, setShowBulkPriority] = useState(false);
  const [showBulkStaff,    setShowBulkStaff]    = useState(false);
  const [showBulkTag,      setShowBulkTag]       = useState(false);
  const [showBulkTemplate, setShowBulkTemplate] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  useEffect(() => { api.get('/fields').then(r => setCustomFields(r.data.filter(f => f.active))).catch(() => {}); }, []);
  const [showDateFilter,   setShowDateFilter]   = useState(false);
  const [showStaffFilter,  setShowStaffFilter]  = useState(false);
  const [staffList,  setStaffList]  = useState([]);
  const [tagList,    setTagList]    = useState([]);
  const [focusedRow, setFocusedRow] = useState(-1);

  const searchRef    = useRef(null);
  const [searchError, setSearchError] = useState('');
  const [showSearchHelp, setShowSearchHelp] = useState(false);
  // Bulk actions: each one needs its permission (checked again by the server)
  const can = perm => user?.role === 'fondateur' || user?.permissions?.includes(perm);
  const canBulk = ['reply_ticket', 'claim_ticket', 'close_ticket'].some(can);
  const [showBulkStage, setShowBulkStage] = useState(false);
  const [bulkTagMode, setBulkTagMode] = useState('add_tag');

  // Split view (Profile preference): the ticket opens next to the list on wide screens
  const [splitPref, setSplitPref] = useState(false);
  useEffect(() => { api.get('/profile/prefs').then(r => setSplitPref(!!r.data.splitView)).catch(() => {}); }, []);
  const [wide, setWide] = useState(() => window.matchMedia?.('(min-width: 1280px)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(min-width: 1280px)');
    if (!mq) return undefined;
    const on = e => setWide(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const split = splitPref && wide;
  const [openId, setOpenId] = useState(null);
  const openTicket = id => (split ? setOpenId(id) : navigate(`/tickets/${id}`));
  // Search in subjects (list filter) or in every message (full-text results)
  const [searchMode, setSearchModeState] = useState(() => { try { return localStorage.getItem('ticketSearchMode') || 'subject'; } catch { return 'subject'; } });
  const setSearchMode = m => { setSearchModeState(m); try { localStorage.setItem('ticketSearchMode', m); } catch { /* storage unavailable */ } };
  const messageSearch = searchMode === 'messages' && filters.subject.trim().length > 0;
  const tableRef     = useRef(null);
  const hoverTimer   = useRef(null);
  const mousePosRef  = useRef({ x: 0, y: 0 });

  const load = useCallback(async () => {
    if (messageSearch) return; // the full-text results replace the list
    setLoading(true);
    try {
      const params = {
        page,
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      };
      const { data: res } = await api.get('/tickets', { params });
      setData(res);
      setSearchError('');
    } catch (err) {
      // Invalid search operator (étape:xyz, avant:2026-02-30…): explained under the search box
      if (err.response?.status === 400) setSearchError(err.response.data?.error || 'Recherche invalide');
    } finally {
      setLoading(false);
    }
  }, [page, filters, messageSearch]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(new Set()); setFocusedRow(-1); }, [page, filters]);
  useAutoRefresh(load);

  /* Load staff + tags + templates */
  useEffect(() => {
    api.get('/tickets/staff').then(r => setStaffList(r.data)).catch(() => {});
    api.get('/ticket-views').then(r => {
      setSavedViews(r.data);
      const def = r.data.find(v => v.is_default);
      if (def) applyView(`saved:${def.id}`, def.filters);
    }).catch(() => {});
    api.get('/tags').then(r => setTagList(r.data)).catch(() => {});
    api.get('/templates').then(r => setTemplates(r.data)).catch(() => {});
  }, []);

  // Known issues in progress (announced to new tickets)
  const [incidents, setIncidents] = useState([]);
  useEffect(() => { api.get('/incidents', { params: { active: 1 } }).then(r => setIncidents(r.data)).catch(() => {}); }, []);

  // Tickets a colleague has open right now: ticketId -> [viewers]
  const [presence, setPresence] = useState({});
  useEffect(() => { api.get('/tickets/presence').then(r => setPresence(r.data)).catch(() => {}); }, []);
  const viewersOf = id => (presence[id] || []).filter(v => v.userId !== user?.id);
  const viewersMark = id => {
    const v = viewersOf(id);
    if (!v.length) return null;
    const label = `Ouvert par ${v.map(x => x.username).join(', ')}`;
    return <span className="inline-flex items-center gap-0.5 text-amber-400" title={label} role="img" aria-label={label}><Eye size={11} />{v.length > 1 && <span className="text-[10px]">{v.length}</span>}</span>;
  };

  useSSE({
    presence: (d) => setPresence(p => ({ ...p, [d.ticketId]: d.viewers })),
    ticket: (d) => {
      setData(prev => ({
        ...prev,
        tickets: prev.tickets.map(t => t.id === d.id ? { ...t, ...d } : t),
      }));
    },
    new_ticket: () => {
      if (page === 1 && filters.status !== 'closed') load();
    },
  });

  const setFilter = (key, val) => {
    setFilters(f => ({ ...f, [key]: val }));
    setPage(1);
  };

  const applyView = (id, viewFilters) => {
    setActiveView(id);
    setFilters({ ...EMPTY_FILTERS, ...viewFilters });
    setPage(1);
  };

  const saveCurrentView = async () => {
    const name = window.prompt('Nom de la vue :');
    if (!name?.trim()) return;
    const viewFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    try {
      const { data: v } = await api.post('/ticket-views', { name: name.trim(), filters: viewFilters });
      setSavedViews(list => [...list, v].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveView(`saved:${v.id}`);
      toast.success(`Vue « ${v.name} » enregistrée`);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  const deleteView = async (v) => {
    if (!await confirmToast(`Supprimer la vue « ${v.name} » ?`)) return;
    try {
      await api.delete(`/ticket-views/${v.id}`);
      setSavedViews(list => list.filter(x => x.id !== v.id));
      if (activeView === `saved:${v.id}`) applyView('open', BUILTIN_VIEWS[0].filters);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  const toggleDefaultView = async (v) => {
    try {
      await api.patch(`/ticket-views/${v.id}`, { is_default: !v.is_default });
      setSavedViews(list => list.map(x => ({ ...x, is_default: x.id === v.id ? !v.is_default : false })));
      toast.success(v.is_default ? 'Vue par défaut retirée (retour à « Ouverts »)' : `« ${v.name} » est ta vue par défaut`);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
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
      if (r.errors?.length) toast.error(r.errors.join(' · '), { duration: 7000 });
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
        if (t) openTicket(t.id);
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
  }, [data.tickets, focusedRow, navigate, split]); // eslint-disable-line react-hooks/exhaustive-deps

  const colCount = canBulk ? 10 : 9;

  const hasDateFilter = filters.dateFrom || filters.dateTo;

  return (
    <div className={split && openId ? 'flex items-start' : ''}>
    <div className={`p-6 space-y-5 pb-24 min-w-0 ${split && openId ? 'w-[46%] shrink-0 overflow-x-auto' : ''}`}>

      {quickView && <QuickView ticket={quickView.ticket} x={quickView.x} y={quickView.y} messages={quickView.messages} />}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="page-header">
          <h1>Tickets</h1>
          <p>{messageSearch ? "Recherche dans les messages" : `${data.total} ticket(s) trouvé(s)`}</p>
        </div>
        <div className="flex items-center gap-2">
        {(user?.role === 'fondateur' || user?.permissions?.includes('create_ticket')) && !user?.demo && <ContactMember />}
        {user?.role === 'fondateur' && (
          <a
            href="/api/tickets/export"
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface border border-overlay/[0.07]
                       text-ink-3 hover:text-ink-1 hover:border-overlay/12 text-xs font-medium
                       transition-all duration-150"
          >
            <Download size={13} /> Export CSV
          </a>
        )}
        </div>
      </div>

      {/* Views: built-in + saved (per user) */}
      <div className="flex items-center gap-2 flex-wrap">
        {BUILTIN_VIEWS.map(v => {
          const isActive = activeView === v.id;
          return (
            <button key={v.id} onClick={() => applyView(v.id, v.filters)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all duration-150 select-none
                          ${isActive
                            ? 'bg-primary/15 text-primary-light border-primary/40 shadow-[0_0_12px_rgba(124,110,243,0.15)]'
                            : 'bg-surface border-overlay/[0.07] text-ink-3 hover:text-ink-1 hover:border-overlay/12'}`}>
              {v.dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${v.dot}`} />}
              {v.label}
            </button>
          );
        })}
        {savedViews.length > 0 && <span className="w-px h-5 bg-overlay/8 mx-1" />}
        {savedViews.map(v => {
          const isActive = activeView === `saved:${v.id}`;
          return (
            <span key={v.id}
              className={`group flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-xl text-xs font-medium border transition-all
                          ${isActive ? 'bg-violet-500/15 text-violet-200 border-violet-400/40' : 'bg-surface border-overlay/[0.07] text-ink-3 hover:text-ink-1'}`}>
              <button onClick={() => applyView(`saved:${v.id}`, v.filters)} className="py-0.5">{v.name}</button>
              <button onClick={() => toggleDefaultView(v)} title={v.is_default ? 'Vue par défaut' : 'Définir comme vue par défaut'}
                className={`p-0.5 rounded-sm ${v.is_default ? 'text-amber-400' : 'text-ink-4 opacity-0 group-hover:opacity-100 hover:text-amber-400'}`}>
                <Star size={11} fill={v.is_default ? 'currentColor' : 'none'} />
              </button>
              <button onClick={() => deleteView(v)} title="Supprimer la vue"
                className="p-0.5 rounded-sm text-ink-4 opacity-0 group-hover:opacity-100 hover:text-red-400">
                <X size={11} />
              </button>
            </span>
          );
        })}
        <button onClick={saveCurrentView} title="Enregistrer les filtres actuels comme vue"
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium border border-dashed border-overlay/12
                     text-ink-3 hover:text-ink-1 hover:border-overlay/20 transition-all">
          <BookmarkPlus size={12} /> Enregistrer la vue
        </button>
      </div>

      {incidents.map(inc => (
        <div key={inc.id} role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-2.5 text-sm">
          <Megaphone size={14} className="text-amber-400 shrink-0" />
          <span className="text-ink-1 font-medium">Incident en cours : {inc.title}</span>
          <span className="text-ink-3 text-xs">annoncé aux nouveaux tickets{inc.subjects?.length ? ` (${inc.subjects.join(', ')})` : ''} · {inc.members} membre(s) touché(s)</span>
          {user?.role === 'fondateur' && <a href="/incidents" className="ml-auto text-xs text-primary-light hover:underline">Gérer</a>}
        </div>
      ))}

      {/* Keyboard hint */}
      <div className="hidden md:flex items-center gap-3 text-[10px] text-ink-4">
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded-sm bg-surface border border-overlay/8 font-mono">J/K</kbd>
          <span>naviguer</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded-sm bg-surface border border-overlay/8 font-mono">↵</kbd>
          <span>ouvrir</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded-sm bg-surface border border-overlay/8 font-mono">/</kbd>
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
            aria-label={searchMode === 'messages' ? 'Rechercher dans les messages' : 'Rechercher par sujet'}
            placeholder={searchMode === 'messages' ? 'Rechercher dans les messages... (/)' : 'Sujet, ou tag:VIP de:pseudo étape:attente… (/)'}
            aria-invalid={!!searchError} aria-describedby={searchError ? 'search-error' : undefined}
            value={filters.subject}
            onChange={e => setFilter('subject', e.target.value)}
            className="w-full bg-surface border border-overlay/[0.07] text-ink-1 placeholder-ink-4
                       rounded-xl pl-9 pr-44 py-2 text-sm
                       focus:outline-hidden focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       hover:border-overlay/12 transition-all duration-150"
          />
          {searchMode === 'subject' && (
            <button type="button" onClick={() => setShowSearchHelp(v => !v)} aria-expanded={showSearchHelp} aria-label="Opérateurs de recherche"
              title="Opérateurs de recherche (tag:, de:, avant:…)"
              className="absolute right-[10.5rem] top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md text-[11px] font-mono text-ink-4 hover:text-ink-1 hover:bg-overlay/6">?:</button>
          )}
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex rounded-lg bg-overlay/4 p-0.5" role="group" aria-label="Où chercher">
            {[['subject', 'Sujets'], ['messages', 'Messages']].map(([m, label]) => (
              <button key={m} onClick={() => setSearchMode(m)} aria-pressed={searchMode === m}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all
                            ${searchMode === m ? 'bg-surface-elevated text-ink-1 shadow-card' : 'text-ink-3 hover:text-ink-1'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Select
          className="w-40"
          value={filters.status}
          onChange={v => { setFilter('status', v); setActiveView(''); }}
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
          onChange={v => { setFilter('priority', v); setActiveView(''); }}
          placeholder="Toutes priorités"
          options={[
            { value: '',       label: 'Toutes priorités' },
            { value: 'low',    label: 'Faible' },
            { value: 'normal', label: 'Normal' },
            { value: 'urgent', label: 'Urgent' },
          ]}
        />
        <Select
          className="w-40"
          value={filters.stage}
          onChange={v => { setFilter('stage', v); setActiveView(''); }}
          placeholder="Toutes étapes"
          options={[
            { value: '',            label: 'Toutes étapes' },
            { value: 'open',        label: 'Ouvert' },
            { value: 'waiting',     label: 'En attente' },
            { value: 'in_progress', label: 'En cours' },
          ]}
        />
        {/* Custom field filter */}
        {customFields.length > 0 && (
          <div className="flex items-center gap-1.5">
            <select value={filters.field} onChange={e => { setFilter('field', e.target.value); setActiveView(''); }} aria-label="Champ personnalisé"
              className="bg-surface border border-overlay/[0.07] text-ink-2 rounded-xl px-2.5 py-2 text-xs focus:outline-hidden">
              <option value="">Champ…</option>
              {customFields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            {filters.field && (
              <input value={filters.fieldValue} onChange={e => { setFilter('fieldValue', e.target.value); setActiveView(''); }} placeholder="Valeur" aria-label="Valeur du champ"
                className="w-28 bg-surface border border-overlay/[0.07] text-ink-1 placeholder-ink-4 rounded-xl px-2.5 py-2 text-xs focus:outline-hidden focus:border-primary/50" />
            )}
          </div>
        )}
        {/* Staff filter */}
        {staffList.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowStaffFilter(o => !o)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium
                          border transition-all duration-150
                          ${filters.assignee
                            ? 'bg-primary/10 text-primary-light border-primary/30'
                            : 'bg-surface border-overlay/[0.07] text-ink-3 hover:text-ink-1 hover:border-overlay/12'}`}
            >
              <User size={13} />
              {filters.assignee
                ? (filters.assignee === 'me' ? 'Moi' : (staffList.find(s => s.user_id === filters.assignee)?.username || 'Staff'))
                : 'Attribué à'}
              {filters.assignee ? (
                <span onClick={e => { e.stopPropagation(); setFilter('assignee', ''); setActiveView(''); setShowStaffFilter(false); }}
                  className="ml-1 hover:text-ink-1 cursor-pointer">
                  <X size={11} />
                </span>
              ) : (
                <ChevronDown size={11} className={showStaffFilter ? 'rotate-180 transition-transform' : 'transition-transform'} />
              )}
            </button>
            {showStaffFilter && (
              <div className="absolute top-full mt-1 left-0 bg-surface-elevated border border-overlay/10
                              rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden min-w-44
                              max-h-52 overflow-y-auto z-20">
                <button
                  onClick={() => { setFilter('assignee', ''); setActiveView(''); setShowStaffFilter(false); }}
                  className="w-full flex items-center px-3.5 py-2.5 text-xs text-ink-3 hover:bg-overlay/5 transition-colors"
                >
                  Tout le monde
                </button>
                {staffList.map(s => (
                  <button
                    key={s.user_id}
                    onClick={() => { setFilter('assignee', s.user_id); setActiveView(''); setShowStaffFilter(false); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs text-ink-2
                               hover:bg-overlay/5 hover:text-ink-1 transition-colors"
                  >
                    {s.username}
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
                        : 'bg-surface border-overlay/[0.07] text-ink-3 hover:text-ink-1 hover:border-overlay/12'}`}
        >
          <Calendar size={13} />
          Date
          {hasDateFilter && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary-light ml-0.5" />
          )}
        </button>
      </div>

      {searchError && <p id="search-error" role="alert" className="text-xs text-red-400 -mt-2">{searchError}</p>}
      {showSearchHelp && searchMode === 'subject' && (
        <div className="rounded-2xl border border-overlay/8 bg-surface-card p-4 text-xs animate-fade-in">
          <p className="text-ink-2 font-medium mb-2">Opérateurs à combiner dans la recherche (les autres mots cherchent dans le sujet) :</p>
          <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
            {SEARCH_HELP.map(([op, desc]) => (
              <div key={op} className="flex gap-2">
                <dt><button type="button" onClick={() => { setFilter('subject', `${filters.subject} ${op}`.trim()); searchRef.current?.focus(); }}
                  className="font-mono text-primary-light hover:underline">{op}</button></dt>
                <dd className="text-ink-3">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Date range row */}
      {showDateFilter && (
        <div className="flex items-center gap-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-3 shrink-0">Du</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={e => setFilter('dateFrom', e.target.value)}
              className="bg-surface border border-overlay/[0.07] text-ink-1 rounded-xl px-3 py-2 text-xs
                         focus:outline-hidden focus:border-primary/50 transition-all
                         scheme-dark"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-3 shrink-0">Au</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={e => setFilter('dateTo', e.target.value)}
              className="bg-surface border border-overlay/[0.07] text-ink-1 rounded-xl px-3 py-2 text-xs
                         focus:outline-hidden focus:border-primary/50 transition-all
                         scheme-dark"
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

      {messageSearch ? <MessageSearch q={filters.subject} status={filters.status} /> : (<>
      {/* Cards on phones */}
      <div className="md:hidden space-y-2">
        {loading && !data.tickets.length ? (
          <div className="h-24 rounded-2xl bg-surface-card border border-overlay/6 animate-pulse" />
        ) : !data.tickets.length ? (
          <p className="text-sm text-ink-3 text-center py-10">Aucun ticket trouvé</p>
        ) : data.tickets.map(t => {
          const sla = slaInfo(t.last_message_at, t.created_at, t.status);
          const unread = t.status === 'open' && isUnread(t.id, t.last_message_at);
          return (
            <button key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}
              className={`w-full text-left bg-surface-card border border-overlay/6 rounded-2xl p-3.5 shadow-card
                          active:bg-overlay/2.5 ${t.priority === 'urgent' ? 'border-l-2 border-l-red-500/50' : ''}`}>
              <div className="flex items-center gap-2 text-xs">
                {unread && <span className="w-1.5 h-1.5 rounded-full bg-primary-light shrink-0" title="Nouveau message" />}
                <span className="font-mono text-ink-4 tabular-nums">#{t.id}</span>
                {t.visibility_grade_id === -1 && <Lock size={11} className="text-red-400 shrink-0" aria-label="Confidentiel" />}
                {hasDraft(`${user?.id}:${user?.guildId}:${t.id}:`) && <PenLine size={11} className="text-amber-400 shrink-0" aria-label="Brouillon" />}
                {viewersMark(t.id)}
                <span className="text-ink-1 font-medium truncate">{t.owner_tag}</span>
                <span className="ml-auto shrink-0"><Badge label={t.status} variant={t.status} /></span>
              </div>
              <p translate="no" className="text-sm text-ink-2 mt-1.5 truncate">{t.subject || <span className="italic text-ink-4">—</span>}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-ink-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[t.priority] || 'bg-ink-4'}`} />
                  {PRIORITY_LABELS[t.priority] || t.priority}
                </span>
                {t.status === 'open' && t.stage && t.stage !== 'open' && (
                  <span className={`font-medium ${STAGE_CLS[t.stage]}`}>{STAGE_LABELS[t.stage]}</span>
                )}
                <span className={t.assignees?.length ? 'text-emerald-400' : 'italic'}>{t.assignees?.length ? assigneeNames(t) : 'Non attribué'}</span>
                {sla && <span className={`font-semibold ${sla.cls}`}>{sla.label} sans réponse</span>}
                <span className="ml-auto tabular-nums">{fmtDate(t.created_at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <SlaBadge sla={t.sla} />
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div
        ref={tableRef}
        className="hidden md:block bg-surface-card border border-overlay/6 rounded-2xl overflow-hidden shadow-card"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-overlay/6">
              {canBulk && (
                <th className="px-3.5 py-3.5 w-10 text-left">
                  <button onClick={toggleAll} aria-label="Tout sélectionner" className="text-ink-4 hover:text-ink-2 transition-colors">
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
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Attribué à</th>
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
                                    border border-overlay/6">
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
                  onClick={() => openTicket(t.id)}
                  onMouseEnter={e => {
                    setFocusedRow(rowIdx);
                    mousePosRef.current = { x: e.clientX, y: e.clientY };
                    hoverTimer.current = setTimeout(async () => {
                      const pos = { x: mousePosRef.current.x, y: mousePosRef.current.y };
                      setQuickView({ ticket: t, x: pos.x, y: pos.y, messages: null });
                      try {
                        const { data: notes } = await api.get(`/tickets/${t.id}/notes`);
                        setQuickView(qv =>
                          qv?.ticket.id === t.id ? { ...qv, messages: notes.slice(-2) } : qv
                        );
                      } catch {
                        setQuickView(qv =>
                          qv?.ticket.id === t.id ? { ...qv, messages: [] } : qv
                        );
                      }
                    }, 1500);
                  }}
                  onMouseMove={e => { mousePosRef.current = { x: e.clientX, y: e.clientY }; }}
                  onMouseLeave={() => { clearTimeout(hoverTimer.current); setQuickView(null); }}
                  className={`
                    border-b border-overlay/4 last:border-0 cursor-pointer transition-colors
                    ${t.priority === 'urgent' ? 'border-l-2 border-l-red-500/50' : ''}
                    ${isSelected || openId === t.id ? 'bg-primary/5' : ''}
                    ${isFocused && !isSelected ? 'bg-overlay/2.5' : ''}
                    ${!isFocused && !isSelected ? 'hover:bg-overlay/1.5' : ''}
                  `}
                >
                  {canBulk && (
                    <td className="px-3.5 py-3.5" onClick={e => toggleOne(t.id, e)}>
                      <button aria-label={`Sélectionner le ticket #${t.id}`} aria-pressed={isSelected} className="text-ink-4 hover:text-primary-light transition-colors">
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
                  <td className="px-4 py-3.5 text-ink-4 font-mono text-xs tabular-nums">
                    <span className="inline-flex items-center gap-1">#{t.id}
                      {t.visibility_grade_id === -1 && <Lock size={11} className="text-red-400" role="img" aria-label="Ticket confidentiel" />}
                      {hasDraft(`${user?.id}:${user?.guildId}:${t.id}:`) && <PenLine size={11} className="text-amber-400" aria-label="Brouillon non envoyé" />}
                      {viewersMark(t.id)}
                    </span>
                  </td>
                  <td translate="no" className="px-4 py-3.5 text-ink-1 font-medium">{t.owner_tag}</td>
                  <td className="px-4 py-3.5 text-ink-2 max-w-xs">
                    <div translate="no" className="truncate">{t.subject || <span className="italic text-ink-4">—</span>}</div>
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
                            <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
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
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <Badge label={t.status} variant={t.status} />
                      {t.status === 'open' && t.stage && t.stage !== 'open' && (
                        <span className={`text-[10px] font-medium ${STAGE_CLS[t.stage]}`}>{STAGE_LABELS[t.stage]}</span>
                      )}
                    </div>
                    <SlaBadge sla={t.sla} />
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[t.priority] || 'bg-ink-4'}`} />
                      {PRIORITY_LABELS[t.priority] || t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-xs truncate max-w-[120px]">
                    {t.assignees?.length
                      ? <span className="text-emerald-400 font-medium" title={assigneeNames(t)}>{assigneeNames(t)}</span>
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
      </>)}

      {/* Bulk action bar */}
      {someSelected && canBulk && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-slide-up
                        flex items-center gap-3 bg-surface-elevated border border-overlay/10
                        rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.7)] px-4 py-3">
          <span className="text-sm font-semibold text-ink-1 tabular-nums">
            {selected.size} sélectionné(s)
          </span>
          <div className="w-px h-4 bg-overlay/8" />

          {/* Priority */}
          <div className="relative">
            <button
              onClick={() => { setShowBulkPriority(p => !p); setShowBulkStaff(false); setShowBulkTag(false); }}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-overlay/8
                         text-ink-2 text-xs font-medium hover:bg-surface-hover hover:text-ink-1
                         transition-all disabled:opacity-50"
            >
              Priorité
              <ChevronDown size={11} className={showBulkPriority ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>
            {showBulkPriority && (
              <div className="absolute bottom-full mb-2 left-0 bg-surface-elevated border border-overlay/10
                              rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden min-w-36 animate-in">
                {[['low','Faible','text-sky-400'],['normal','Normal','text-amber-400'],['urgent','Urgent','text-red-400']].map(([val, label, cls]) => (
                  <button
                    key={val}
                    onClick={() => { bulkAction('priority', val); setShowBulkPriority(false); }}
                    className={`w-full flex items-center gap-2 px-3.5 py-2.5 text-xs
                                hover:bg-overlay/5 transition-colors ${cls}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Stage */}
          {can('reply_ticket') && (
            <div className="relative">
              <button
                onClick={() => { setShowBulkStage(p => !p); setShowBulkPriority(false); setShowBulkStaff(false); setShowBulkTag(false); }}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-overlay/8
                           text-ink-2 text-xs font-medium hover:bg-surface-hover hover:text-ink-1
                           transition-all disabled:opacity-50"
              >
                Étape
                <ChevronDown size={11} className={showBulkStage ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {showBulkStage && (
                <div className="absolute bottom-full mb-2 left-0 bg-surface-elevated border border-overlay/10
                                rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden min-w-36 animate-in">
                  {Object.entries(STAGE_LABELS).map(([val, label]) => (
                    <button key={val} onClick={() => { bulkAction('stage', val); setShowBulkStage(false); }}
                      className={`w-full flex items-center gap-2 px-3.5 py-2.5 text-xs hover:bg-overlay/5 transition-colors ${STAGE_CLS[val]}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Assign staff */}
          {staffList.length > 0 && can('claim_ticket') && (
            <div className="relative">
              <button
                onClick={() => { setShowBulkStaff(p => !p); setShowBulkPriority(false); setShowBulkTag(false); }}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-overlay/8
                           text-ink-2 text-xs font-medium hover:bg-surface-hover hover:text-ink-1
                           transition-all disabled:opacity-50"
              >
                Assigner
                <ChevronDown size={11} className={showBulkStaff ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {showBulkStaff && (
                <div className="absolute bottom-full mb-2 left-0 bg-surface-elevated border border-overlay/10
                                rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden min-w-44
                                max-h-48 overflow-y-auto animate-in">
                  {staffList.map(s => (
                    <button
                      key={s.user_id}
                      onClick={() => { bulkAction('assign', s.user_id); setShowBulkStaff(false); }}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs text-ink-2
                                 hover:bg-overlay/5 hover:text-ink-1 transition-colors"
                    >
                      {s.username}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add or remove a tag */}
          {tagList.length > 0 && can('reply_ticket') && (
            <div className="relative">
              <button
                onClick={() => { setShowBulkTag(p => !p); setShowBulkPriority(false); setShowBulkStaff(false); }}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-overlay/8
                           text-ink-2 text-xs font-medium hover:bg-surface-hover hover:text-ink-1
                           transition-all disabled:opacity-50"
              >
                Tag
                <ChevronDown size={11} className={showBulkTag ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {showBulkTag && (
                <div className="absolute bottom-full mb-2 left-0 bg-surface-elevated border border-overlay/10
                                rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden min-w-40
                                max-h-56 overflow-y-auto animate-in">
                  <div className="flex m-1.5 rounded-lg bg-overlay/4 p-0.5" role="group" aria-label="Ajouter ou retirer">
                    {[['add_tag', 'Ajouter'], ['remove_tag', 'Retirer']].map(([m, l]) => (
                      <button key={m} onClick={() => setBulkTagMode(m)} aria-pressed={bulkTagMode === m}
                        className={`flex-1 px-2 py-1 rounded-md text-[11px] font-medium ${bulkTagMode === m ? 'bg-surface-elevated text-ink-1 shadow-card' : 'text-ink-3'}`}>{l}</button>
                    ))}
                  </div>
                  {tagList.map(t => (
                    <button
                      key={t.id}
                      onClick={() => { bulkAction(bulkTagMode, t.id); setShowBulkTag(false); }}
                      className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs hover:bg-overlay/5 transition-colors"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
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
          {templates.length > 0 && can('reply_ticket') && (
            <div className="relative">
              <button
                onClick={() => { setShowBulkTemplate(p => !p); setShowBulkPriority(false); setShowBulkStaff(false); setShowBulkTag(false); }}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-overlay/8
                           text-ink-2 text-xs font-medium hover:bg-surface-hover hover:text-ink-1
                           transition-all disabled:opacity-50"
              >
                <FileText size={11} /> Réponse
                <ChevronDown size={11} className={showBulkTemplate ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {showBulkTemplate && (
                <div className="absolute bottom-full mb-2 left-0 bg-surface-elevated border border-overlay/10
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
                                 hover:bg-overlay/5 transition-colors text-left"
                    >
                      <FileText size={11} className="text-primary-light mt-0.5 shrink-0" />
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

          {can('close_ticket') && (<>
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
          </>)}

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
    {split && openId && (
      <section aria-label={`Ticket #${openId}`} className="flex-1 min-w-0 sticky top-0 h-screen overflow-y-auto border-l border-overlay/6">
        <TicketDetail key={openId} embeddedId={openId} onClose={() => setOpenId(null)} />
      </section>
    )}
    </div>
  );
}
