import React, { useEffect, useState, useCallback, useRef} from 'react';
import { uiLocale } from '../i18n';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Star, FileText, User, Clock, X, Send,
  MessageSquare, Reply, UserPlus, FolderOpen, Pencil,
  Lock, CheckCircle2, Eye, EyeOff, Layers, Check, ChevronDown, History, Users, Sparkles, GitMerge, Paperclip, AlarmClock, Link2, PanelRight, Pin, PinOff, Volume2, Bell, BellRing, ImagePlus
} from 'lucide-react';
import api from '../api';
import Badge from '../components/Badge';
import Select from '../components/Select';
import toast from 'react-hot-toast';
import { fmtDate } from '../utils/format';
import { useAuth } from '../App';
import useDraft from '../hooks/useDraft';
import MessageContent from '../components/MessageContent';
import DiscordPreview from '../components/DiscordPreview';
import ConfidentialAccess from '../components/ConfidentialAccess';
import TimeTracker from '../components/TimeTracker';
import LabelChips from '../components/LabelChips';
import { useSSE } from '../hooks/useSSE';
import SlaBadge, { fmtMinutes } from '../components/SlaBadge';
import { confirmToast } from '../utils/confirmToast';
import { availabilityLabel } from '../utils/availability';

// {{username}}, {{ticket_id}}… and the custom fields of the ticket ({{commande}}…)
function hasVars(text) { return /\{\{[a-z][a-z0-9_]*\}\}/i.test(text); }

function resolveVars(text, ticket, staffUsername) {
  const date = new Date().toLocaleDateString(uiLocale());
  const fieldValues = new Map((ticket?.fields || []).map(f => [f.variable, f.value ?? '']));
  return text
    .replace(/\{\{([a-z][a-z0-9_]*)\}\}/gi, (m, v) => (fieldValues.has(v.toLowerCase()) ? fieldValues.get(v.toLowerCase()) : m))
    .replace(/\{\{username\}\}/gi,   ticket?.owner_tag   ?? '')
    .replace(/\{\{ticket_id\}\}/gi,  String(ticket?.id   ?? ''))
    .replace(/\{\{date\}\}/gi,       date)
    .replace(/\{\{staff_name\}\}/gi, staffUsername        ?? '')
    .replace(/\{\{subject\}\}/gi,    ticket?.subject     ?? '');
}

const PRIORITY_LABELS = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };
const STAGES = [
  { value: 'open',        label: 'Ouvert',     cls: 'text-sky-300 bg-sky-500/10 border-sky-500/25' },
  { value: 'waiting',     label: 'En attente', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
  { value: 'in_progress', label: 'En cours',   cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25' },
];

const PRIORITY_ACTIVE = {
  low:    'bg-sky-500/10 text-sky-400 border-sky-500/20',
  normal: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  urgent: 'bg-red-500/10 text-red-400 border-red-500/20',
};

/* ─── Sub-components ─────────────────────────────────────────── */
function SectionTitle({ children }) {
  return (
    <p className="text-[10px] font-bold text-ink-4 uppercase tracking-[0.12em] mb-3">{children}</p>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-overlay/4 last:border-0">
      <div className="w-6 h-6 rounded-lg bg-overlay/4 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={11} className="text-ink-3" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-ink-4 leading-tight font-medium">{label}</p>
        <p className="text-xs text-ink-2 mt-0.5 break-all">{value}</p>
      </div>
    </div>
  );
}

function getBubbleAlign(source) {
  if (source === 'user') return 'left';
  if (source === 'system') return 'event';
  if (source === 'web')  return 'center';
  return 'right';
}

function getBubbleStyle(source) {
  if (source === 'user') return {
    bubble: 'bg-surface-card text-ink-2 border border-overlay/8',
    avatar: 'from-violet-500 to-violet-700',
    label: null,
  };
  if (source === 'reply') return {
    bubble: 'bg-linear-to-br from-primary to-indigo-600 text-white shadow-lg shadow-primary/20',
    avatar: 'from-primary to-indigo-600',
    label: 'Réponse',
  };
  if (source === 'discord') return {
    bubble: 'bg-surface-elevated text-ink-2 border border-overlay/8',
    avatar: 'from-surface-hover to-surface-elevated',
    label: 'Discord',
  };
  return null;
}

// Colleagues who have this ticket open right now (avatars, names on hover)
function Viewers({ viewers }) {
  if (!viewers.length) return null;
  const names = viewers.map(v => v.username).join(', ');
  const label = `${names} ${viewers.length > 1 ? 'ont' : 'a'} aussi ce ticket ouvert`;
  return (
    <div className="flex items-center gap-1.5" title={label} aria-label={label} role="status">
      <Eye size={12} className="text-amber-400" />
      <div className="flex -space-x-1.5">
        {viewers.slice(0, 4).map(v => (
          v.avatar
            ? <img key={v.userId} src={`https://cdn.discordapp.com/avatars/${v.userId}/${v.avatar}.webp?size=32`} alt=""
                className="w-5 h-5 rounded-full ring-2 ring-base object-cover" />
            : <span key={v.userId} className="w-5 h-5 rounded-full ring-2 ring-base bg-primary/40 text-[9px] font-bold text-white flex items-center justify-center">
                {v.username?.[0]?.toUpperCase() || '?'}
              </span>
        ))}
      </div>
      <span className="text-[11px] text-amber-400 font-medium hidden sm:inline">
        {viewers.length === 1 ? viewers[0].username : `${viewers.length} collègues`}
      </span>
    </div>
  );
}

const STAFF_REPLY_SOURCES = new Set(['reply', 'scheduled', 'discord']);

function DiscordAvatar({ authorId, authorAvatar, authorTag, gradient }) {
  const avatarUrl = authorId && authorAvatar
    ? `https://cdn.discordapp.com/avatars/${authorId}/${authorAvatar}.webp?size=64`
    : null;

  const base = 'w-8 h-8 rounded-full shadow-md shrink-0 mb-1';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={authorTag || ''}
        className={`${base} object-cover`}
      />
    );
  }
  return (
    <div className={`${base} bg-linear-to-br ${gradient}
                     flex items-center justify-center text-xs font-bold text-white`}>
      {authorTag?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────── */
// embeddedId: shown next to the ticket list (split view, Tickets page); onClose leaves it
export default function TicketDetail({ embeddedId = null, onClose = null }) {
  const { id: routeId } = useParams();
  const id = embeddedId ? String(embeddedId) : routeId;
  const embedded = !!embeddedId;
  const navigate = useNavigate();
  const goBack = () => (onClose ? onClose() : navigate('/tickets'));
  const { user } = useAuth();

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  // Below lg the information column is a drawer
  const [infoOpen, setInfoOpen] = useState(false);
  useEffect(() => setInfoOpen(false), [id]);
  // ?note=<id> (from the message search): scroll to that message and highlight it
  const [searchParams] = useSearchParams();
  const focusNote = parseInt(searchParams.get('note')) || null;
  const [flashNote, setFlashNote] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [notes, setNotes] = useState([]);
  // Unsent texts survive leaving the page (per user, server and ticket)
  const draftKey = user ? `${user.id}:${user.guildId}:${id}` : null;
  const [newNote, setNewNote, noteRestored] = useDraft(draftKey && `${draftKey}:note`);
  const [savingNote, setSavingNote] = useState(false);
  const [replyText, setReplyText, replyRestored] = useDraft(draftKey && `${draftKey}:reply`);
  const [sendingReply, setSendingReply] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [newParticipantId, setNewParticipantId] = useState('');
  const [addingParticipant, setAddingParticipant] = useState(false);
  const [movingTicket, setMovingTicket] = useState(false);
  const [staff, setStaff] = useState([]);
  const [assigneeToAdd, setAssigneeToAdd] = useState('');
  const [composeMode, setComposeMode] = useState('reply');
  const [grades, setGrades] = useState([]);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [ticketTags, setTicketTags] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [userHistory, setUserHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [subjectInput, setSubjectInput] = useState('');
  const [savingSubject, setSavingSubject] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateScope, setNewTemplateScope] = useState('personal');
  const [newTemplateActions, setNewTemplateActions] = useState({});
  const [linkTemplateSubject, setLinkTemplateSubject] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const templatesRef = useRef(null);
  const bottomRef = useRef(null);

  const ticketId = parseInt(id);

  const loadTicket = useCallback(() => {
    api.get(`/tickets/${id}`)
      .then(r => setTicket(r.data))
      .catch(() => toast.error('Ticket introuvable'))
      .finally(() => setLoading(false));
  }, [id]);

  const loadNotes = useCallback(() => {
    api.get(`/tickets/${id}/notes`).then(r => setNotes(r.data)).catch(() => {});
  }, [id]);

  useEffect(() => {
    loadTicket();
    loadNotes();
    api.get('/tickets/staff').then(r => setStaff(r.data)).catch(() => {});
    api.get('/grades').then(r => setGrades(r.data)).catch(() => {});
    api.get('/tags').then(r => setAllTags(r.data)).catch(() => {});
    api.get(`/tags/ticket/${id}`).then(r => setTicketTags(r.data)).catch(() => {});
    localStorage.setItem(`ticket_seen_${id}`, Date.now().toString());
  }, [loadTicket, loadNotes, id]);

  // Templates matching the ticket subject come back first, flagged `suggested`
  const ticketLoaded = !!ticket;
  useEffect(() => {
    if (!ticketLoaded) return;
    api.get('/templates', { params: ticket?.subject ? { subject: ticket.subject } : {} }).then(r => setTemplates(r.data)).catch(() => {});
  }, [ticketLoaded, ticket?.subject]);

  const focusedOnce = useRef(null);
  useEffect(() => {
    // Opened from a search result: show that message once, then follow new messages as usual
    const target = focusNote && focusedOnce.current !== `${id}:${focusNote}` && document.getElementById(`note-${focusNote}`);
    if (target) {
      focusedOnce.current = `${id}:${focusNote}`;
      target.scrollIntoView({ block: 'center' });
      setFlashNote(focusNote);
      setTimeout(() => setFlashNote(null), 3000);
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [notes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell colleagues I am writing (at most every 4 s while the text changes); stop when emptied
  const typingSentAt = useRef(0);
  const draft = composeMode === 'note' ? newNote : replyText;
  useEffect(() => {
    if (!ticketId) return;
    if (!draft.trim()) {
      if (typingSentAt.current) { typingSentAt.current = 0; api.post(`/tickets/${id}/typing`, { mode: composeMode, stop: true }).catch(() => {}); }
      return;
    }
    if (Date.now() - typingSentAt.current < 4000) return;
    typingSentAt.current = Date.now();
    api.post(`/tickets/${id}/typing`, { mode: composeMode }).catch(() => {});
  }, [draft, composeMode, id, ticketId]);

  // Last message seen when I started this reply (to spot a colleague answering meanwhile)
  // (null = not known yet: draft restored before the messages loaded)
  const replyStartNote = useRef(null);
  const replyWasEmpty = useRef(true);
  const lastNoteId = () => (notes.length ? notes.reduce((m, n) => Math.max(m, n.id), 0) : null);
  const replyForTicket = useRef(id);
  useEffect(() => {
    const empty = !replyText.trim();
    if (replyForTicket.current !== id) {
      // Other ticket: the loaded messages are still the previous ticket's, wait for the new ones
      replyForTicket.current = id;
      replyStartNote.current = null;
      setNotes([]);
    } else if (replyWasEmpty.current && !empty) replyStartNote.current = lastNoteId();
    replyWasEmpty.current = empty;
  }, [replyText, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (replyStartNote.current === null && !replyWasEmpty.current) replyStartNote.current = lastNoteId();
  }, [notes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Colleagues writing in this ticket right now: userId -> { username, mode, at }
  const [typers, setTypers] = useState({});
  useEffect(() => {
    const t = setInterval(() => setTypers(prev => {
      const fresh = Object.fromEntries(Object.entries(prev).filter(([, v]) => Date.now() - v.at < 8000));
      return Object.keys(fresh).length === Object.keys(prev).length ? prev : fresh;
    }), 2000);
    return () => clearInterval(t);
  }, []);

  // Presence: heartbeat every 20 s while the page is open, departure signal when leaving
  const [viewers, setViewers] = useState([]);
  useEffect(() => {
    if (!ticketId) return;
    let alive = true;
    const beat = () => api.post(`/tickets/${ticketId}/presence`).then(r => { if (alive) setViewers(Array.isArray(r.data?.viewers) ? r.data.viewers : []); }).catch(() => {});
    // keepalive: still delivered while the tab closes (custom header kept, unlike sendBeacon)
    const leave = () => fetch(`/api/tickets/${ticketId}/presence`, {
      method: 'POST', keepalive: true, credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ leave: true }),
    }).catch(() => {});
    beat();
    const t = setInterval(beat, 20000);
    window.addEventListener('pagehide', leave);
    return () => { alive = false; clearInterval(t); window.removeEventListener('pagehide', leave); leave(); setViewers([]); };
  }, [ticketId]);
  const otherViewers = viewers.filter(v => v.userId !== user?.id);

  useSSE({
    presence: (data) => { if (data.ticketId === ticketId) setViewers(Array.isArray(data.viewers) ? data.viewers : []); },
    availability: (data) => setStaff(list => list.map(m => (m.user_id === data.userId ? { ...m, availability: data.availability } : m))),
    typing: (data) => {
      if (data.ticketId !== ticketId || data.userId === user?.id) return;
      setTypers(prev => {
        const next = { ...prev };
        if (data.stop) delete next[data.userId];
        else next[data.userId] = { username: data.username, mode: data.mode, at: Date.now() };
        return next;
      });
    },
    procedure: (data) => { if (data.ticketId === ticketId) setProcedures(data.procedures || []); },
    note_update: (data) => {
      if (data.ticketId !== ticketId) return;
      setNotes(prev => prev.map(n => (n.id === data.note.id ? { ...n, ...data.note } : n)));
    },
    note: (data) => {
      if (data.ticketId !== ticketId) return;
      setNotes(prev => {
        if (prev.some(n => n.id === data.note.id)) return prev;
        localStorage.setItem(`ticket_seen_${id}`, Date.now().toString());
        return [...prev, data.note];
      });
    },
    ticket: (data) => {
      if (data.id !== ticketId) return;
      setTicket(prev => prev ? { ...prev, ...data } : prev);
      if (data.subject !== undefined) setSubjectInput(data.subject || '');
    },
    participant_add: (data) => {
      if (data.ticketId !== ticketId) return;
      setTicket(prev => {
        if (!prev) return prev;
        if (prev.participants?.some(p => p.id === data.userId)) return prev;
        return { ...prev, participants: [...(prev.participants || []), { id: data.userId, tag: data.tag }] };
      });
    },
    participant_remove: (data) => {
      if (data.ticketId !== ticketId) return;
      setTicket(prev => prev ? {
        ...prev, participants: (prev.participants || []).filter(p => p.id !== data.userId)
      } : prev);
    }
  });

  useEffect(() => {
    if (!showTemplates) return;
    function handleClick(e) {
      if (templatesRef.current && !templatesRef.current.contains(e.target)) setShowTemplates(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTemplates]);

  /* ── keyboard shortcuts ─────────────────────────────────────── */
  const replyRef = useRef(null);
  useEffect(() => {
    function handler(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'Escape') { goBack(); return; }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setComposeMode('reply');
        setTimeout(() => replyRef.current?.focus(), 30);
        return;
      }
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setComposeMode('note');
        setTimeout(() => replyRef.current?.focus(), 30);
        return;
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  /* ─── Actions ──────────────────────────────────────────────── */
  const changePriority = async (priority) => {
    setSaving(true);
    try {
      await api.patch(`/tickets/${id}/priority`, { priority });
      setTicket(t => ({ ...t, priority }));
      toast.success('Priorité mise à jour');
    } catch { toast.error('Erreur lors de la mise à jour'); }
    finally { setSaving(false); }
  };

  const changeStatus = async (status) => {
    // Closing with steps left in a procedure asks first
    const left = procedures.reduce((n, p) => n + (p.total - p.done), 0);
    if (status === 'closed' && left > 0 && !await confirmToast(`Il reste ${left} étape(s) de procédure non cochée(s). Fermer quand même ?`)) return;
    setActionLoading(true);
    try {
      await api.patch(`/tickets/${id}/status`, { status });
      setTicket(t => ({ ...t, status }));
      toast.success(status === 'closed' ? 'Ticket fermé' : 'Ticket réouvert');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setActionLoading(false); }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const { data } = await api.post(`/tickets/${id}/notes`, { content: newNote.trim() });
      setNewNote('');
      if (data.mentioned?.length) toast.success(`${data.mentioned.length} personne(s) mentionnée(s) prévenue(s)`);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSavingNote(false); }
  };

  // @mentions in internal notes: suggestions while typing "@abc" — staff members and grades
  // ("@Chef support" notifies every member of that grade)
  const mentionQuery = composeMode === 'note' ? (/(?:^|\s)@([\w.]{0,32})$/.exec(newNote)?.[1] ?? null) : null;
  const mentionMatches = mentionQuery === null ? [] : [
    ...staff.filter(m => m.user_id !== user?.id && m.username?.toLowerCase().startsWith(mentionQuery.toLowerCase()))
      .map(m => ({ key: `u${m.user_id}`, label: m.username })),
    ...grades.filter(g => g.name?.toLowerCase().startsWith(mentionQuery.toLowerCase()))
      .map(g => ({ key: `g${g.id}`, label: g.name, grade: true })),
  ].slice(0, 8);
  const insertMention = (label) => {
    setNewNote(n => n.replace(/@([\w.]{0,32})$/, `@${label} `));
    replyRef.current?.focus();
  };

  // Real file sent with the reply (8 Mo max): attached to the member's DM and the channel
  const [replyFile, setReplyFile] = useState(null);
  const [macroTpl, setMacroTpl] = useState(null);
  const fileInputRef = useRef(null);
  const acceptFile = (f) => {
    if (!f) return false;
    if (f.size > 8 * 1024 * 1024) { toast.error('Fichier trop volumineux (8 Mo max)'); return false; }
    if (composeMode !== 'reply') setComposeMode('reply'); // files go with a reply to the member
    setReplyFile(f);
    return true;
  };
  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    acceptFile(f);
  };
  // Screenshot pasted (Ctrl+V) or file dropped on the reply area
  const pasteFile = (e) => {
    // Copied text (even with an image, e.g. from a document) is pasted as text, as usual
    if (e.clipboardData?.types?.includes('text/plain')) return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.kind === 'file');
    const f = item?.getAsFile();
    if (!f) return;
    e.preventDefault();
    const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const named = f.name && f.name !== 'image.png' ? f : new File([f], `capture-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`, { type: f.type });
    if (acceptFile(named)) toast.success('Capture jointe à la réponse');
  };
  const [dragOver, setDragOver] = useState(false);
  const dropFile = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length > 1) toast('Un seul fichier par réponse : le premier est joint');
    acceptFile(files[0]);
  };
  const [preview, setPreview] = useState(false);

  const sendReply = async () => {
    if (!replyText.trim() && !replyFile) return;
    // Avoid double answers: a colleague replied since I started writing, or is writing a reply now
    const since = replyStartNote.current ?? Infinity;
    const answered = notes.filter(n => n.id > since && STAFF_REPLY_SOURCES.has(n.source) && n.author_id !== user?.id);
    const writing = Object.values(typers).filter(t => t.mode === 'reply').map(t => t.username);
    if (answered.length && !await confirmToast(`${answered.at(-1).author_tag} a répondu au membre pendant que tu écrivais. Envoyer quand même ?`)) return;
    if (!answered.length && writing.length && !await confirmToast(`${writing.join(', ')} ${writing.length > 1 ? 'écrivent' : 'écrit'} aussi une réponse. Envoyer quand même ?`)) return;
    setSendingReply(true);
    try {
      if (macroTpl && !replyFile) {
        const { data } = await api.post(`/tickets/${id}/apply-template`, { templateId: macroTpl.id, content: replyText.trim(), anonymous });
        setMacroTpl(null);
        setReplyText('');
        toast.success(['Réponse envoyée', ...data.applied].join(' · '));
        data.warnings.forEach(w => toast.error(w, { duration: 6000 }));
        loadTicket();
        return;
      }
      if (replyFile) {
        const form = new FormData();
        form.append('file', replyFile);
        if (replyText.trim()) form.append('content', replyText.trim());
        form.append('anonymous', anonymous ? 'true' : 'false');
        await api.post(`/tickets/${id}/reply-file`, form);
        setReplyFile(null);
      } else {
        await api.post(`/tickets/${id}/reply`, { content: replyText.trim(), anonymous });
      }
      setReplyText('');
      toast.success('Réponse envoyée');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSendingReply(false); }
  };

  const addAssignee = async (userId) => {
    if (!userId) return;
    const target = staff.find(s => s.user_id === userId);
    if (target && userId !== user?.id && (target.vacation_mode || target.availability === 'away')
        && !await confirmToast(`${target.username} est ${availabilityLabel(target).toLowerCase()}. L'attribuer quand même ?`)) return;
    setClaimLoading(true);
    try {
      const { data } = await api.post(`/tickets/${id}/assignees`, { user_id: userId });
      setTicket(t => ({ ...t, assignees: data.assignees }));
      setAssigneeToAdd('');
      toast.success(userId === user?.id ? 'Tu es assigné au ticket' : 'Membre assigné');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setClaimLoading(false); }
  };

  const removeAssignee = async (userId) => {
    setClaimLoading(true);
    try {
      const { data } = await api.delete(`/tickets/${id}/assignees/${userId}`);
      setTicket(t => ({ ...t, assignees: data.assignees }));
      toast.success(userId === user?.id ? 'Tu t\'es retiré du ticket' : 'Membre retiré');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setClaimLoading(false); }
  };

  const addParticipant = async () => {
    if (!newParticipantId.trim()) return;
    setAddingParticipant(true);
    try {
      const { data } = await api.post(`/tickets/${id}/participants`, { discord_id: newParticipantId.trim() });
      setTicket(t => ({ ...t, participants: [...(t.participants || []), data] }));
      setNewParticipantId('');
      toast.success(`${data.tag} ajouté`);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setAddingParticipant(false); }
  };

  const removeParticipant = async (userId) => {
    try {
      await api.delete(`/tickets/${id}/participants/${userId}`);
      setTicket(t => ({ ...t, participants: t.participants.filter(p => p.id !== userId) }));
      toast.success('Participant retiré');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  // Custom fields (editable by the staff)
  const [fieldEdits, setFieldEdits] = useState({});
  const saveFields = async () => {
    try {
      const { data } = await api.put(`/tickets/${id}/fields`, { values: fieldEdits });
      setTicket(t => ({ ...t, fields: data.fields }));
      setFieldEdits({});
      toast.success('Informations enregistrées');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  // Linked tickets
  const [linkInput, setLinkInput] = useState('');
  const addLink = async () => {
    const other = parseInt(linkInput.replace('#', ''));
    if (!other) return toast.error('Numéro de ticket invalide');
    try {
      const { data } = await api.post(`/tickets/${id}/links`, { ticketId: other });
      setTicket(t => ({ ...t, links: data.links }));
      setLinkInput('');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const removeLink = async (otherId) => {
    try {
      const { data } = await api.delete(`/tickets/${id}/links/${otherId}`);
      setTicket(t => ({ ...t, links: data.links }));
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  // Personal reminders on this ticket
  const [reminders, setReminders] = useState([]);
  const [reminderNote, setReminderNote] = useState('');
  useEffect(() => { api.get(`/tickets/${id}/reminders`).then(r => setReminders(r.data)).catch(() => {}); }, [id]);
  const addReminder = async (delay) => {
    try {
      const { data } = await api.post(`/tickets/${id}/reminders`, { in: delay, note: reminderNote.trim() || undefined });
      setReminders(r => [data, ...r]);
      setReminderNote('');
      toast.success(`Rappel prévu le ${fmtDate(data.remind_at, { dateStyle: 'medium', timeStyle: 'short' })}`);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const removeReminder = async (rid) => {
    try { await api.delete(`/tickets/reminders/${rid}`); setReminders(r => r.filter(x => x.id !== rid)); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  // Follow-up after a low rating
  const [followupText, setFollowupText] = useState('');
  const [sendingFollowup, setSendingFollowup] = useState(false);
  const sendFollowup = async () => {
    setSendingFollowup(true);
    try {
      await api.post(`/tickets/${id}/followup`, { content: followupText.trim() });
      setFollowupText('');
      toast.success('Message envoyé au membre');
      loadTicket();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSendingFollowup(false); }
  };

  // Merge: other open tickets of the same member
  const [mergeCandidates, setMergeCandidates] = useState(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const [merging, setMerging] = useState(false);
  const loadMergeCandidates = () => api.get(`/tickets/${id}/merge-candidates`)
    .then(r => { setMergeCandidates(r.data); setMergeTarget(r.data[0] ? String(r.data[0].id) : ''); })
    .catch(err => toast.error(err.response?.data?.error || 'Erreur'));
  const mergeInto = async () => {
    const target = mergeCandidates?.find(c => String(c.id) === mergeTarget);
    if (!target) return;
    if (!await confirmToast(`Fusionner ce ticket dans #${target.id}${target.subject ? ` « ${target.subject} »` : ''} ? L'historique, les participants, les attributions et les tags y seront déplacés, puis ce ticket sera fermé et son salon supprimé.`)) return;
    setMerging(true);
    try {
      await api.post(`/tickets/${id}/merge`, { into: target.id });
      toast.success(`Ticket fusionné dans #${target.id}`);
      navigate(`/tickets/${target.id}`);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setMerging(false); }
  };

  const moveTicket = async (stage) => {
    if (stage === ticket.stage) return;
    setMovingTicket(true);
    try {
      const { data } = await api.patch(`/tickets/${id}/move`, { stage });
      setTicket(t => ({ ...t, stage: data.stage }));
      loadTicket(); // SLA restarts in the new stage
      toast.success(`Ticket passé en « ${data.label} »`);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setMovingTicket(false); }
  };

  const saveSubject = async () => {
    setSavingSubject(true);
    try {
      const { data } = await api.patch(`/tickets/${id}/subject`, { subject: subjectInput.trim() || null });
      setTicket(t => ({ ...t, subject: data.subject }));
      toast.success(data.channelName ? `Titre mis à jour — salon Discord : ${data.channelName}` : 'Titre mis à jour');
      return true;
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; }
    finally { setSavingSubject(false); }
  };

  // What the team knows about this member (profile: labels, pinned posts)
  const [memberSummary, setMemberSummary] = useState(null);
  useEffect(() => {
    if (!ticket?.owner_id) return;
    api.get(`/profiles/${ticket.owner_id}/summary`).then(r => setMemberSummary(Array.isArray(r.data?.pinned) ? r.data : null)).catch(() => setMemberSummary(null));
  }, [ticket?.owner_id]);

  // Procedures of the ticket's subject (checklists), kept in sync live
  const [procedures, setProcedures] = useState([]);
  useEffect(() => {
    if (!ticket) return;
    api.get(`/tickets/${id}/procedures`).then(r => setProcedures(r.data)).catch(() => setProcedures([]));
  }, [id, ticket?.subject]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleStep = async (proc, step) => {
    setProcedures(list => list.map(p => (p.id !== proc.id ? p : { ...p, steps: p.steps.map(s => (s.id === step.id ? { ...s, checked: !s.checked } : s)) })));
    try {
      const { data } = await api.put(`/tickets/${id}/procedures/${proc.id}/steps/${step.id}`, { checked: !step.checked });
      setProcedures(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
      api.get(`/tickets/${id}/procedures`).then(r => setProcedures(r.data)).catch(() => {});
    }
  };

  // Closed tickets about the same problem (open tickets only, refreshed when the member writes)
  const [similar, setSimilar] = useState(null);
  const memberMsgCount = notes.filter(n => n.source === 'user').length;
  useEffect(() => {
    if (!ticket || ticket.status !== 'open') { setSimilar(null); return; }
    api.get(`/tickets/${id}/similar`).then(r => setSimilar(r.data)).catch(() => setSimilar(null));
  }, [id, ticket?.status, ticket?.subject, Math.min(memberMsgCount, 5)]); // eslint-disable-line react-hooks/exhaustive-deps
  const reuseReply = text => { setComposeMode('reply'); setReplyText(text); toast.success('Réponse reprise dans la zone de saisie : adapte-la avant d\'envoyer'); };

  const togglePin = async (note) => {
    try {
      const { data } = await api.post(`/tickets/${id}/notes/${note.id}/pin`, { pinned: !note.pinned_at });
      setNotes(n => n.map(x => (x.id === data.id ? { ...x, ...data } : x)));
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const pinnedNotes = notes.filter(n => n.pinned_at).sort((a, b) => new Date(a.pinned_at) - new Date(b.pinned_at));

  const deleteNote = async (noteId) => {
    const note = notes.find(n => n.id === noteId);
    // A reply already sent is withdrawn (member's DM deleted), and stays in the history as such
    if (note?.editable && !await confirmToast('Retirer cette réponse ? Le MP sera supprimé chez le membre ; la réponse reste visible ici, marquée comme retirée.')) return;
    try {
      const { data } = await api.delete(`/tickets/${id}/notes/${noteId}`);
      if (data?.retracted) {
        setNotes(n => n.map(x => (x.id === noteId ? { ...x, deleted_at: new Date().toISOString(), editable: false } : x)));
        toast.success(data.dms?.total ? `Réponse retirée (${data.dms.done}/${data.dms.total} MP supprimé(s))` : 'Réponse retirée');
      } else {
        setNotes(n => n.filter(x => x.id !== noteId));
      }
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur lors de la suppression'); }
  };

  // Correcting a reply already sent (the member's DM is edited too) or an internal note
  const [editingNote, setEditingNote] = useState(null); // { id, text }
  const [savingEdit, setSavingEdit] = useState(false);
  const saveNoteEdit = async () => {
    if (!editingNote?.text.trim()) return;
    setSavingEdit(true);
    try {
      const { data } = await api.patch(`/tickets/${id}/notes/${editingNote.id}`, { content: editingNote.text });
      const fresh = await api.get(`/tickets/${id}/notes`);
      setNotes(fresh.data);
      setEditingNote(null);
      toast.success(data.dms?.total ? `Réponse corrigée (${data.dms.done}/${data.dms.total} MP modifié(s))` : 'Message modifié');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSavingEdit(false); }
  };
  const canEditNote = note => !note.deleted_at && canDeleteNote(note) && can('reply_ticket') && (note.editable || note.source === 'web');
  const noteEditor = note => (
    <div className="w-full max-w-sm space-y-1.5">
      <textarea value={editingNote.text} onChange={e => setEditingNote(x => ({ ...x, text: e.target.value }))} rows={3} maxLength={2000}
        aria-label="Nouveau texte" autoFocus
        onKeyDown={e => { if (e.key === 'Escape') setEditingNote(null); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveNoteEdit(); }}
        className="w-full bg-surface border border-primary/40 text-ink-1 rounded-xl px-3 py-2 text-sm focus:outline-hidden resize-y" />
      <div className="flex justify-end gap-2 text-xs">
        <button onClick={() => setEditingNote(null)} className="px-2.5 py-1 rounded-lg text-ink-3 hover:text-ink-1">Annuler</button>
        <button onClick={saveNoteEdit} disabled={savingEdit || !editingNote.text.trim()} className="px-2.5 py-1 rounded-lg bg-primary text-white font-semibold disabled:opacity-50">
          {note.source === 'reply' ? 'Corriger la réponse' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );

  const saveTemplate = async () => {
    if (!composeText.trim() || !newTemplateName.trim()) return;
    setSavingTemplate(true);
    try {
      const linked = linkTemplateSubject && ticket?.subject;
      const { data } = await api.post('/templates', {
        name: newTemplateName.trim(), content: composeText.trim(),
        subject: linked ? ticket.subject : null, scope: newTemplateScope,
        actions: Object.values(newTemplateActions).some(Boolean) ? newTemplateActions : null,
      });
      setNewTemplateActions({});
      setTemplates(t => [...t, { ...data, suggested: !!linked }]);
      setNewTemplateName('');
      toast.success(newTemplateScope === 'shared' ? 'Modèle partagé avec le staff' : 'Modèle enregistré pour toi');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSavingTemplate(false); }
  };

  const applyTemplate = (tpl) => {
    setComposeText(resolveVars(tpl.content, ticket, user?.username));
    setShowTemplates(false);
    replyRef.current?.focus();
    // Macro: its actions run when the reply is sent (the use is counted then)
    if (tpl.actions && composeMode === 'reply') setMacroTpl(tpl);
    else api.post(`/templates/${tpl.id}/use`).catch(() => {});
  };

  const deleteTemplate = async (tplId, e) => {
    e.stopPropagation();
    try {
      await api.delete(`/templates/${tplId}`);
      setTemplates(t => t.filter(x => x.id !== tplId));
    } catch { toast.error('Erreur'); }
  };

  const loadUserHistory = async () => {
    try {
      const { data } = await api.get(`/tickets/${id}/history`);
      setUserHistory(data);
      setShowHistory(true);
    } catch { toast.error('Erreur'); }
  };

  const addTagToTicket = async (tagId) => {
    try {
      await api.post(`/tags/ticket/${id}`, { tag_id: tagId });
      const tag = allTags.find(t => t.id === tagId);
      if (tag && !ticketTags.find(t => t.id === tagId)) setTicketTags(prev => [...prev, tag]);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  const removeTagFromTicket = async (tagId) => {
    try {
      await api.delete(`/tags/ticket/${id}/${tagId}`);
      setTicketTags(prev => prev.filter(t => t.id !== tagId));
    } catch { toast.error('Erreur'); }
  };

  const changeVisibility = async (gradeId) => {
    setSavingVisibility(true);
    try {
      const { data } = await api.patch(`/tickets/${id}/visibility`, { visibility_grade_id: gradeId ? parseInt(gradeId) : null });
      setTicket(t => ({ ...t, visibility_grade_id: gradeId ? parseInt(gradeId) : null }));
      if (data.channelSync === 'missing_permissions') {
        toast.error('Visibilité mise à jour sur le dashboard, mais le salon Discord n\'a pas pu être modifié : le bot n\'a pas la permission « Gérer les rôles ».', { duration: 8000 });
      } else {
        toast.success('Visibilité mise à jour');
      }
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSavingVisibility(false); }
  };

  const canDeleteNote = (note) => user?.role === 'fondateur' || note.author_id === user?.id;

  const toggleFollow = async () => {
    try {
      const { data } = await api.post(`/tickets/${id}/follow`, { follow: !ticket.following });
      setTicket(t => ({ ...t, following: data.following }));
      toast.success(data.following ? 'Tu seras prévenu des nouveaux messages de ce ticket' : 'Tu ne suis plus ce ticket');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  const [voiceBusy, setVoiceBusy] = useState(false);
  const openVoice = async () => {
    setVoiceBusy(true);
    try {
      const { data } = await api.post(`/tickets/${id}/voice`);
      setTicket(t => ({ ...t, voice_channel_id: data.channelId, voiceUrl: data.url }));
      toast.success('Salon vocal ouvert : le membre a reçu le lien en MP');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setVoiceBusy(false); }
  };
  const closeVoice = async () => {
    setVoiceBusy(true);
    try {
      await api.delete(`/tickets/${id}/voice`);
      setTicket(t => ({ ...t, voice_channel_id: null, voiceUrl: null }));
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setVoiceBusy(false); }
  };

  /* ─── Loading / not found ──────────────────────────────────── */
  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
        <p className="text-sm text-ink-4">Chargement...</p>
      </div>
    </div>
  );
  if (!ticket) return (
    <div className="flex-1 p-6 text-red-400 text-sm">Ticket introuvable.</div>
  );

  const assignees   = ticket.assignees || [];
  const amAssigned  = assignees.some(a => a.user_id === user?.id);
  // Each action is shown according to the grade permission the API checks for it
  const can         = perm => user?.role === 'fondateur' || !!user?.permissions?.includes(perm);
  const canAssign   = can('claim_ticket');
  const assignable  = staff.filter(s => !assignees.some(a => a.user_id === s.user_id));
  const currentStage = STAGES.find(st => st.value === (ticket.stage || 'open'));

  const composeText    = composeMode === 'note' ? newNote    : replyText;
  const setComposeText = composeMode === 'note' ? setNewNote : setReplyText;
  const composeSending = composeMode === 'note' ? savingNote : sendingReply;
  const handleSend     = composeMode === 'note' ? addNote    : sendReply;


  /* ─── Shared panel card ─────────────────────────────────────── */
  const panelCard = 'bg-overlay/2.5 rounded-xl border border-overlay/6 p-4';

  return (
    <div className="flex flex-1 min-h-screen overflow-hidden">

      {/* ── Modal: réouvrir ─────────────────────────────────── */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="bg-surface-card border border-overlay/10 rounded-2xl p-6 w-full max-w-sm
                          shadow-[0_24px_80px_rgba(0,0,0,0.8)] animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-ink-1">Réouvrir le ticket</h2>
              <button onClick={() => setShowReopenModal(false)}
                className="text-ink-4 hover:text-ink-2 transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-ink-3 mb-1.5 block">Raison (optionnel)</label>
                <textarea rows={3} value={reopenReason} onChange={e => setReopenReason(e.target.value)}
                  placeholder="Raison de la réouverture..."
                  className="w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4
                             rounded-xl px-3.5 py-2.5 text-sm focus:outline-hidden focus:border-primary/50
                             resize-none transition-all" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowReopenModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-surface text-ink-2 text-sm
                             hover:bg-surface-hover transition-colors">
                  Annuler
                </button>
                <button
                  onClick={async () => {
                    setShowReopenModal(false);
                    setActionLoading(true);
                    try {
                      await api.patch(`/tickets/${id}/status`, { status: 'open' });
                      if (reopenReason.trim()) {
                        await api.post(`/tickets/${id}/notes`, { content: `Réouverture : ${reopenReason.trim()}` });
                      }
                      setTicket(t => ({ ...t, status: 'open' }));
                      setReopenReason('');
                      toast.success('Ticket réouvert');
                    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
                    finally { setActionLoading(false); }
                  }}
                  disabled={actionLoading}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold
                             hover:bg-emerald-500 transition-colors disabled:opacity-50">
                  Réouvrir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: historique ───────────────────────────────── */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="bg-surface-card border border-overlay/10 rounded-2xl p-6 w-full max-w-lg
                          shadow-[0_24px_80px_rgba(0,0,0,0.8)] animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-ink-1">Historique de {ticket.owner_tag}</h2>
              <button onClick={() => setShowHistory(false)}
                className="text-ink-4 hover:text-ink-2 transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {userHistory.map(t => (
                <button key={t.id}
                  onClick={() => { setShowHistory(false); navigate(`/tickets/${t.id}`); }}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl
                             hover:bg-overlay/4 text-left transition-colors">
                  <div className="min-w-0">
                    <span className="text-xs text-ink-4 font-mono mr-2 tabular-nums">#{t.id}</span>
                    <span className="text-sm text-ink-2">{t.subject || 'Sans sujet'}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border
                                     ${t.status === 'open'
                                       ? 'bg-primary/10 text-primary-light border-primary/20'
                                       : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                      {t.status === 'open' ? 'ouvert' : 'fermé'}
                    </span>
                    <span className="text-[10px] text-ink-4">{fmtDate(t.created_at)}</span>
                  </div>
                </button>
              ))}
              {userHistory.length === 0 && (
                <p className="text-sm text-ink-4 text-center py-6">Aucun ticket trouvé</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ Left column: chat ═════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 min-h-screen overflow-hidden">

        {/* Sticky header */}
        <div className="sticky top-0 z-10 glass-dark border-b border-overlay/6
                        ${embedded ? 'pl-3' : 'pl-14 lg:pl-5'} pr-3 sm:pr-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
          <button onClick={goBack} aria-label={embedded ? 'Fermer le ticket' : 'Retour aux tickets'}
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/6
                       transition-all shrink-0">
            {embedded ? <X size={16} /> : <ArrowLeft size={16} />}
          </button>
          <div className="h-4 w-px bg-overlay/8 shrink-0" />
          <span className="text-sm font-bold text-ink-1 tabular-nums">Ticket #{ticket.id}</span>
          <Badge label={ticket.status} variant={ticket.status} />
          <Badge label={PRIORITY_LABELS[ticket.priority] || ticket.priority} variant={ticket.priority} />
          {ticket.owner_tag && (
            <span className="text-xs text-ink-3 ml-0.5">{ticket.owner_tag}</span>
          )}
          {/* Title (= ticket subject): editable in place */}
          {editingTitle ? (
            <div className="flex items-center gap-1.5 min-w-0 flex-1 max-w-md">
              <input type="text" value={subjectInput} autoFocus maxLength={100}
                onChange={e => setSubjectInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveSubject().then(ok => ok && setEditingTitle(false));
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
                placeholder="Titre du ticket…"
                className="flex-1 min-w-0 bg-surface border border-primary/40 text-ink-1 placeholder-ink-4
                           rounded-lg px-2.5 py-1 text-sm focus:outline-hidden" />
              <button onClick={() => saveSubject().then(ok => ok && setEditingTitle(false))} disabled={savingSubject}
                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50 shrink-0" title="Enregistrer"><Check size={15} /></button>
              <button onClick={() => setEditingTitle(false)} className="text-ink-4 hover:text-ink-2 shrink-0" title="Annuler"><X size={15} /></button>
            </div>
          ) : can('reply_ticket') ? (
            <button onClick={() => { setSubjectInput(ticket.subject || ''); setEditingTitle(true); }}
              title="Modifier le titre"
              className="group flex items-center gap-1.5 min-w-0 text-sm text-ink-2 hover:text-ink-1">
              <span className="truncate max-w-xs">{ticket.subject || <span className="italic text-ink-4">Ajouter un titre</span>}</span>
              <Pencil size={12} className="text-ink-4 group-hover:text-ink-2 shrink-0" />
            </button>
          ) : ticket.subject && (
            <span translate="no" className="text-sm text-ink-2 truncate max-w-xs">{ticket.subject}</span>
          )}

          <div className="ml-auto flex items-center gap-2 shrink-0">
            <Viewers viewers={otherViewers} />
            <button onClick={loadUserHistory} aria-label="Historique du membre"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                         text-ink-3 hover:text-ink-1 hover:bg-overlay/6 border border-overlay/[0.07]
                         transition-all">
              <History size={12} /> <span className="hidden sm:inline">Historique</span>
            </button>
            <button onClick={toggleFollow} aria-pressed={!!ticket.following}
              title={ticket.following ? 'Ne plus suivre ce ticket' : 'Suivre : être prévenu des nouveaux messages sans en être responsable'}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all
                          ${ticket.following ? 'bg-primary/10 text-primary-light border-primary/30' : 'text-ink-3 hover:text-ink-1 hover:bg-overlay/6 border-overlay/[0.07]'}`}>
              {ticket.following ? <BellRing size={12} /> : <Bell size={12} />} <span className="hidden sm:inline">{ticket.following ? 'Suivi' : 'Suivre'}</span>
            </button>
            {ticket.status === 'open' && can('reply_ticket') && (ticket.voiceUrl ? (
              <span className="flex items-center rounded-lg border border-emerald-500/30 bg-emerald-500/8 text-xs font-medium">
                <a href={ticket.voiceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-2.5 py-1.5 text-emerald-300 hover:text-ink-1">
                  <Volume2 size={12} /> <span className="hidden sm:inline">Rejoindre le vocal</span>
                </a>
                <button onClick={closeVoice} disabled={voiceBusy} aria-label="Fermer le salon vocal" title="Fermer le salon vocal"
                  className="px-2 py-1.5 border-l border-emerald-500/30 text-ink-3 hover:text-red-400 disabled:opacity-50"><X size={12} /></button>
              </span>
            ) : (
              <button onClick={openVoice} disabled={voiceBusy} aria-label="Ouvrir un salon vocal" title="Salon vocal temporaire avec le membre (supprimé à la fermeture du ticket)"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-ink-3 hover:text-ink-1 hover:bg-overlay/6 border border-overlay/[0.07] transition-all disabled:opacity-50">
                <Volume2 size={12} /> <span className="hidden sm:inline">Vocal</span>
              </button>
            ))}
            <a href={`/api/tickets/${id}/pdf`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                         text-ink-3 hover:text-ink-1 hover:bg-overlay/6 border border-overlay/[0.07]
                         transition-all">
              <FileText size={12} /> PDF
            </a>
            <button onClick={() => setInfoOpen(true)} aria-label="Infos du ticket" aria-expanded={infoOpen}
              className={`${embedded ? '' : 'lg:hidden '}flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                         text-ink-3 hover:text-ink-1 hover:bg-overlay/6 border border-overlay/[0.07] transition-all`}>
              <PanelRight size={12} /> Infos
            </button>
            {ticket.created_at && (
              <span className="hidden sm:inline text-xs text-ink-4 tabular-nums">
                {fmtDate(ticket.created_at, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-6 space-y-5">
          {notes.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-20">
              <div className="w-14 h-14 rounded-2xl bg-surface-card border border-overlay/[0.07]
                              flex items-center justify-center">
                <MessageSquare size={22} className="text-ink-4" />
              </div>
              <p className="text-sm font-semibold text-ink-3">Aucun message</p>
              <p className="text-xs text-ink-4">Les messages apparaîtront ici.</p>
            </div>
          )}

          {ticket.visibility_grade_id === -1 && (
            <div role="status" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/8 px-4 py-2.5 text-xs text-ink-1">
              <Lock size={13} className="text-red-400 mt-0.5 shrink-0" />
              <span><strong>Ticket confidentiel</strong> — seuls les fondateurs le voient, sur le dashboard comme sur Discord. Le membre l'a demandé à l'ouverture (signalement, harcèlement…).</span>
            </div>
          )}

          {/* Pinned internal notes: always visible at the top of the conversation */}
          {pinnedNotes.length > 0 && (
            <div className="sticky top-0 z-[5] -mt-2 rounded-xl border border-amber-500/25 bg-surface-elevated/95 backdrop-blur-xs p-3 space-y-2 shadow-card">
              {pinnedNotes.map(n => (
                <div key={n.id} className="flex items-start gap-2">
                  <Pin size={12} className="text-amber-400 mt-0.5 shrink-0" />
                  <button onClick={() => document.getElementById(`note-${n.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                    className="min-w-0 flex-1 text-left">
                    <p translate="no" className="text-xs text-ink-1 whitespace-pre-wrap wrap-break-word line-clamp-3">{n.content}</p>
                    <p className="text-[10px] text-ink-4 mt-0.5">{n.author_tag} · épinglée par {n.pinned_by_tag}</p>
                  </button>
                  {can('reply_ticket') && (
                    <button onClick={() => togglePin(n)} aria-label="Désépingler" title="Désépingler"
                      className="text-ink-4 hover:text-ink-1 shrink-0"><PinOff size={12} /></button>
                  )}
                </div>
              ))}
            </div>
          )}

          {notes.map(note => {
            const align = getBubbleAlign(note.source);

            /* Internal note */
            // Automatic event (merge, closed by the member…): a discreet line, not a message
            if (align === 'event') {
              return (
                <div key={note.id} id={`note-${note.id}`} className="flex items-center gap-3 animate-fade-in" role="note">
                  <span className="h-px flex-1 bg-overlay/8" />
                  <p className="text-[11px] text-ink-3 text-center max-w-md">
                    {note.content} <span className="text-ink-4">· {fmtDate(note.created_at)}</span>
                  </p>
                  <span className="h-px flex-1 bg-overlay/8" />
                </div>
              );
            }
            if (align === 'center') {
              return (
                <div key={note.id} id={`note-${note.id}`} className="flex justify-center group animate-fade-in">
                  <div className={`flex items-start gap-2 max-w-md px-4 py-2.5 rounded-xl
                                  bg-surface border border-dashed border-overlay/8 ${flashNote === note.id ? 'ring-2 ring-amber-400' : ''}`}>
                    <Lock size={10} className="text-ink-4 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      {editingNote?.id === note.id ? noteEditor(note) : (
                        <p className="text-xs text-ink-2 leading-relaxed whitespace-pre-wrap wrap-break-word">
                          <MessageContent text={note.content} />
                        </p>
                      )}
                      <p className="text-[10px] text-ink-4 mt-1.5">
                        {note.author_tag} · {fmtDate(note.created_at)}{note.edited_at ? ` · modifiée ${fmtDate(note.edited_at)}` : ''}
                      </p>
                    </div>
                    {canEditNote(note) && editingNote?.id !== note.id && (
                      <button onClick={() => setEditingNote({ id: note.id, text: note.content })} aria-label="Modifier la note" title="Modifier"
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-ink-4 hover:text-ink-1 transition-all shrink-0 mt-0.5">
                        <Pencil size={10} />
                      </button>
                    )}
                    {can('reply_ticket') && (
                      <button onClick={() => togglePin(note)} aria-label={note.pinned_at ? 'Désépingler la note' : 'Épingler la note'}
                        title={note.pinned_at ? 'Désépingler' : 'Épingler en haut du ticket'}
                        className={`${note.pinned_at ? 'text-amber-400' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-ink-4 hover:text-ink-1'}
                                   transition-all shrink-0 mt-0.5`}>
                        <Pin size={10} />
                      </button>
                    )}
                    {canDeleteNote(note) && (
                      <button onClick={() => deleteNote(note.id)} aria-label="Supprimer la note"
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-ink-4 hover:text-red-400
                                   transition-all shrink-0 mt-0.5">
                        <X size={10} />
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            const style  = getBubbleStyle(note.source);
            const isLeft = align === 'left';

            return (
              <div key={note.id} id={`note-${note.id}`}
                className={`flex items-end gap-2.5 group animate-fade-in rounded-2xl transition-shadow
                            ${flashNote === note.id ? 'ring-2 ring-amber-400 ring-offset-4 ring-offset-base' : ''}
                            ${isLeft ? 'mr-16' : 'ml-16 flex-row-reverse'}`}>
                {/* Avatar — Discord avatar when available */}
                <DiscordAvatar
                  authorId={note.author_id}
                  authorAvatar={note.author_avatar}
                  authorTag={note.author_tag}
                  gradient={style.avatar}
                />

                {/* Bubble */}
                <div className={`flex flex-col gap-1 min-w-0 ${isLeft ? 'items-start' : 'items-end'}`}>
                  <div className={`flex items-center gap-1.5 px-0.5 ${isLeft ? '' : 'flex-row-reverse'}`}>
                    <span className="text-[10px] text-ink-3 font-medium">{note.author_tag}</span>
                    {style.label && (
                      <span className="text-[9px] text-ink-4 font-semibold uppercase tracking-wide">
                        · {style.label}
                      </span>
                    )}
                  </div>

                  {editingNote?.id === note.id ? noteEditor(note) : (
                    <div className={`relative px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                                     whitespace-pre-wrap wrap-break-word max-w-sm ${style.bubble}
                                     ${isLeft ? 'rounded-tl-md' : 'rounded-tr-md'} ${note.deleted_at ? 'opacity-60 border-dashed' : ''}`}>
                      <MessageContent text={note.content} light={!isLeft} />
                    </div>
                  )}

                  {/* Edited / deleted by the member in their DMs (previous versions kept for the staff) */}
                  {(note.edited_at || note.deleted_at) && (
                    <details className={`text-[10px] px-0.5 max-w-sm ${isLeft ? '' : 'text-right'}`}>
                      <summary className={`cursor-pointer select-none font-medium ${note.deleted_at ? 'text-red-400' : 'text-amber-400'}`}>
                        {note.deleted_at
                          ? (note.source === 'reply' ? `Réponse retirée · ${fmtDate(note.deleted_at)}` : `Supprimé par le membre · ${fmtDate(note.deleted_at)}`)
                          : `Modifié · ${fmtDate(note.edited_at)}`}
                        {note.edit_history?.length ? ` · ${note.edit_history.length} version(s) précédente(s)` : ''}
                      </summary>
                      {note.edit_history?.length > 0 && (
                        <ol className="mt-1.5 space-y-1.5">
                          {[...note.edit_history].reverse().map((h, i) => (
                            <li key={i} className="rounded-lg border border-overlay/8 bg-overlay/2.5 px-2.5 py-1.5 text-left">
                              <p className="text-ink-4">Avant {fmtDate(h.at)}</p>
                              <p className="text-ink-2 whitespace-pre-wrap wrap-break-word">{h.content}</p>
                            </li>
                          ))}
                        </ol>
                      )}
                    </details>
                  )}

                  <div className={`flex items-center gap-2 px-0.5 ${isLeft ? '' : 'flex-row-reverse'}`}>
                    <span className="text-[10px] text-ink-4 tabular-nums">{fmtDate(note.created_at)}</span>
                    {canEditNote(note) && editingNote?.id !== note.id && (
                      <button onClick={() => setEditingNote({ id: note.id, text: note.edit_text ?? note.content })}
                        aria-label={note.source === 'reply' ? 'Corriger la réponse' : 'Modifier'} title={note.source === 'reply' ? 'Corriger (le MP du membre est modifié aussi)' : 'Modifier'}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-ink-4 hover:text-ink-1 transition-all">
                        <Pencil size={10} />
                      </button>
                    )}
                    {canDeleteNote(note) && !(note.source === 'reply' && note.deleted_at) && (
                      <button onClick={() => deleteNote(note.id)} aria-label={note.editable ? 'Retirer la réponse' : 'Supprimer la note'}
                        title={note.editable ? 'Retirer (le MP du membre est supprimé)' : 'Supprimer'}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-ink-4 hover:text-red-400
                                   transition-all">
                        <X size={10} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Compose box */}
        {ticket.status === 'open' && can('reply_ticket') && (
          <div className="border-t border-overlay/6 glass-dark px-5 py-4 shrink-0">
            {/* Mode toggle */}
            <div className="flex gap-0.5 mb-3 bg-surface rounded-xl p-1 w-fit border border-overlay/6">
              <button onClick={() => setComposeMode('reply')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold
                            transition-all ${composeMode === 'reply'
                              ? 'bg-primary text-white shadow-lg shadow-primary/30'
                              : 'text-ink-3 hover:text-ink-2'}`}>
                <Reply size={11} />
                Répondre
              </button>
              <button onClick={() => setComposeMode('note')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold
                            transition-all ${composeMode === 'note'
                              ? 'bg-surface-elevated text-ink-1 shadow-xs'
                              : 'text-ink-3 hover:text-ink-2'}`}>
                <Lock size={11} />
                Note interne
              </button>
            </div>

            {/* Suggested replies for this subject */}
            {!composeText && templates.some(t => t.suggested) && (
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span className="flex items-center gap-1 text-[10px] text-ink-4"><Sparkles size={10} /> Suggestions</span>
                {templates.filter(t => t.suggested).slice(0, 4).map(tpl => (
                  <button key={tpl.id} onClick={() => applyTemplate(tpl)} title={resolveVars(tpl.content, ticket, user?.username)}
                    className="px-2 py-1 rounded-lg text-[11px] text-ink-2 bg-surface border border-overlay/[0.07] hover:text-ink-1 hover:border-primary/40 max-w-48 truncate">
                    {tpl.name}
                  </button>
                ))}
              </div>
            )}

            {macroTpl && composeMode === 'reply' && (
              <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg text-[11px] bg-amber-500/10 border border-amber-500/20 text-amber-200">
                <span className="font-semibold">Macro « {macroTpl.name} »</span>
                <span className="text-amber-200 truncate">
                  à l'envoi : {[
                    macroTpl.actions.assignSelf && 'm\'attribuer',
                    macroTpl.actions.priority && `priorité ${({ low: 'faible', normal: 'normale', urgent: 'urgente' })[macroTpl.actions.priority]}`,
                    macroTpl.actions.tagId && `tag ${allTags.find(tg => tg.id === macroTpl.actions.tagId)?.name || ''}`,
                    macroTpl.actions.stage && !macroTpl.actions.close && `étape ${STAGES.find(st => st.value === macroTpl.actions.stage)?.label}`,
                    macroTpl.actions.close && 'fermer le ticket',
                  ].filter(Boolean).join(', ')}
                </span>
                <button onClick={() => setMacroTpl(null)} className="ml-auto hover:text-ink-1" aria-label="Envoyer sans les actions"><X size={11} /></button>
              </div>
            )}

            {Object.keys(typers).length > 0 && (
              <p className="mb-2 text-[11px] text-amber-300 flex items-center gap-1.5" role="status" aria-live="polite">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
                {Object.values(typers).map(t => t.username).join(', ')}{' '}
                {Object.keys(typers).length > 1 ? 'sont' : 'est'} en train d'écrire
                {Object.values(typers).every(t => t.mode === 'note') ? ' une note' : ' une réponse'} sur ce ticket
              </p>
            )}

            {/* @mention suggestions (internal notes) */}
            {mentionQuery !== null && mentionMatches.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5" role="listbox" aria-label="Mentionner un membre du staff ou un grade">
                {mentionMatches.map(m => (
                  <button key={m.key} role="option" aria-selected="false" onClick={() => insertMention(m.label)}
                    title={m.grade ? 'Grade : prévient tous ses membres' : undefined}
                    className={`px-2 py-1 rounded-lg text-[11px] bg-surface border hover:text-ink-1 hover:border-primary/40
                                ${m.grade ? 'border-violet-500/30 text-violet-300' : 'border-overlay/8 text-ink-2'}`}>
                    @{m.label}{m.grade && <span className="ml-1 text-[9px] uppercase opacity-70">grade</span>}
                  </button>
                ))}
              </div>
            )}

            {/* Textarea (drop a file, or paste a screenshot, to attach it) */}
            <div className="relative" onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }} onDrop={dropFile}>
            {dragOver && (
              <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/60 bg-primary/10 text-sm text-primary-light pointer-events-none">
                <ImagePlus size={16} /> Dépose le fichier pour le joindre à la réponse
              </div>
            )}
            {preview ? (
              <div className="min-h-[5.5rem] max-h-72 overflow-y-auto rounded-xl border border-overlay/8 bg-[#313338]/40 px-4 py-3" aria-label="Aperçu du message sur Discord">
                {composeText.trim() ? <DiscordPreview text={composeMode === 'reply' ? resolveVars(composeText, ticket, user?.username) : composeText} />
                  : <p className="text-sm text-ink-4">Rien à prévisualiser</p>}
              </div>
            ) : (
            <textarea
              ref={replyRef}
              value={composeText}
              onChange={e => setComposeText(e.target.value)}
              onPaste={pasteFile}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSend(); }}
              placeholder={composeMode === 'reply'
                ? 'Répondre à l\'utilisateur... (Ctrl+Entrée)'
                : 'Note interne (non visible par l\'utilisateur)...'}
              rows={3}
              maxLength={2000}
              className={`w-full bg-surface border text-ink-1 placeholder-ink-4 rounded-xl px-4 py-3
                          text-sm focus:outline-hidden resize-none transition-all
                          ${composeMode === 'reply'
                            ? 'border-primary/30 focus:border-primary/60 focus:ring-1 focus:ring-primary/20'
                            : 'border-overlay/[0.07] focus:border-overlay/12'}`}
            />
            )}
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-ink-4 tabular-nums">{composeText.length}/2000</span>
                <button onClick={() => setPreview(p => !p)} aria-pressed={preview} title="Voir le rendu sur Discord (gras, liens, listes…)"
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all
                              ${preview ? 'bg-primary/10 text-primary-light border-primary/30' : 'bg-surface text-ink-3 border-overlay/[0.07] hover:text-ink-1'}`}>
                  <Eye size={11} /> {preview ? 'Modifier' : 'Aperçu'}
                </button>
                {(composeMode === 'note' ? noteRestored : replyRestored) && (
                  <span className="text-[10px] text-amber-400 font-medium">
                    Brouillon restauré ·{' '}
                    <button onClick={() => setComposeText('')} className="underline hover:text-amber-300">effacer</button>
                  </span>
                )}
                <span className="text-[10px] text-ink-4 hidden sm:block">
                  <kbd className="px-1 py-0.5 rounded-sm bg-surface border border-overlay/[0.07] font-mono text-[9px]">R</kbd> répondre ·{' '}
                  <kbd className="px-1 py-0.5 rounded-sm bg-surface border border-overlay/[0.07] font-mono text-[9px]">N</kbd> note ·{' '}
                  <kbd className="px-1 py-0.5 rounded-sm bg-surface border border-overlay/[0.07] font-mono text-[9px]">ESC</kbd> retour
                </span>

                {/* Templates */}
                <div className="relative" ref={templatesRef}>
                  <button onClick={() => setShowTemplates(t => !t)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                               border bg-surface text-ink-3 border-overlay/[0.07]
                               hover:text-ink-1 hover:border-overlay/12 transition-all">
                    <Layers size={11} />
                    Modèles
                    <ChevronDown size={10} className={`transition-transform duration-200 ${showTemplates ? 'rotate-180' : ''}`} />
                  </button>
                  {showTemplates && (
                    <div className="absolute bottom-full mb-2 left-0 z-20 w-72 bg-surface-elevated
                                    border border-overlay/10 rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.7)]
                                    overflow-hidden animate-in">
                      <div className="max-h-52 overflow-y-auto">
                        {templates.length === 0 ? (
                          <p className="text-xs text-ink-4 p-4 text-center">Aucun modèle enregistré</p>
                        ) : [
                          ['Suggérés pour ce sujet', t => t.suggested],
                          ['Mes modèles', t => !t.suggested && t.scope === 'personal'],
                          ['Partagés avec le staff', t => !t.suggested && t.scope !== 'personal'],
                        ].map(([label, inGroup]) => {
                          const group = templates.filter(inGroup);
                          if (!group.length) return null;
                          return (
                            <div key={label}>
                              <p className="px-3.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-4">{label}</p>
                              {group.map(tpl => (
                                <div key={tpl.id}
                                  className="group/tpl flex items-start gap-2 px-3.5 py-2.5
                                             hover:bg-overlay/4 border-b border-overlay/5 last:border-0
                                             transition-colors cursor-pointer"
                                  onClick={() => applyTemplate(tpl)}>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <p className="text-xs font-semibold text-ink-1 truncate">{tpl.name}</p>
                                      {tpl.scope === 'personal' && tpl.suggested && (
                                        <span className="text-[9px] font-bold px-1 py-0.5 rounded-sm bg-overlay/6 text-ink-3 border border-overlay/8 shrink-0">perso</span>
                                      )}
                                      {tpl.actions && (
                                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20 shrink-0">macro</span>
                                      )}
                                      {hasVars(tpl.content) && (
                                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-violet-500/20
                                                         text-violet-300 border border-violet-500/20 shrink-0">
                                          vars
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[10px] text-ink-3 truncate mt-0.5">
                                      {resolveVars(tpl.content, ticket, user?.username)}
                                    </p>
                                    {tpl.scope !== 'personal' && !tpl.mine && (
                                      <p className="text-[9px] text-ink-4 mt-0.5">par {tpl.created_by_tag}</p>
                                    )}
                                  </div>
                                  {(user?.role === 'fondateur' || tpl.created_by_id === user?.id) && (
                                    <button onClick={(e) => deleteTemplate(tpl.id, e)} title="Supprimer le modèle"
                                      className="opacity-0 group-hover/tpl:opacity-100 text-ink-4
                                                 hover:text-red-400 transition-all shrink-0 mt-0.5">
                                      <X size={11} />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                        <div className="border-t border-overlay/[0.07] px-3.5 py-2.5 space-y-2 bg-overlay/2">
                          <input type="text" placeholder="Nom du modèle..." maxLength={100}
                            value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)}
                            className="w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4
                                       rounded-lg px-3 py-2 text-xs focus:outline-hidden focus:border-primary/50
                                       transition-all" />
                          <div className="flex gap-1 p-0.5 rounded-lg bg-surface border border-overlay/6" role="radiogroup" aria-label="Portée du modèle">
                            {[['personal', 'Pour moi'], ['shared', 'Pour tout le staff']].map(([v, label]) => (
                              <button key={v} type="button" role="radio" aria-checked={newTemplateScope === v} onClick={() => setNewTemplateScope(v)}
                                className={`flex-1 py-1 rounded-md text-[11px] font-medium ${newTemplateScope === v ? 'bg-primary/15 text-ink-1' : 'text-ink-4 hover:text-ink-2'}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                          <details className="text-[11px] text-ink-3">
                            <summary className="cursor-pointer select-none">Actions à l'envoi (macro)</summary>
                            <div className="mt-2 grid grid-cols-2 gap-1.5">
                              <select value={newTemplateActions.stage || ''} onChange={e => setNewTemplateActions(a => ({ ...a, stage: e.target.value || undefined }))}
                                className="bg-surface border border-overlay/8 rounded-lg px-2 py-1.5 text-[11px] text-ink-1" aria-label="Étape">
                                <option value="">Étape inchangée</option>
                                {STAGES.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
                              </select>
                              <select value={newTemplateActions.priority || ''} onChange={e => setNewTemplateActions(a => ({ ...a, priority: e.target.value || undefined }))}
                                className="bg-surface border border-overlay/8 rounded-lg px-2 py-1.5 text-[11px] text-ink-1" aria-label="Priorité">
                                <option value="">Priorité inchangée</option>
                                <option value="low">Faible</option><option value="normal">Normal</option><option value="urgent">Urgent</option>
                              </select>
                              <select value={newTemplateActions.tagId || ''} onChange={e => setNewTemplateActions(a => ({ ...a, tagId: e.target.value ? parseInt(e.target.value) : undefined }))}
                                className="bg-surface border border-overlay/8 rounded-lg px-2 py-1.5 text-[11px] text-ink-1 col-span-2" aria-label="Tag">
                                <option value="">Aucun tag</option>
                                {allTags.map(tg => <option key={tg.id} value={tg.id}>{tg.name}</option>)}
                              </select>
                              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!newTemplateActions.assignSelf} onChange={e => setNewTemplateActions(a => ({ ...a, assignSelf: e.target.checked || undefined }))} /> M'attribuer</label>
                              <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!newTemplateActions.close} onChange={e => setNewTemplateActions(a => ({ ...a, close: e.target.checked || undefined }))} /> Fermer le ticket</label>
                            </div>
                          </details>
                          {ticket?.subject && (
                            <label className="flex items-center gap-2 text-[11px] text-ink-3 cursor-pointer">
                              <input type="checkbox" checked={linkTemplateSubject} onChange={e => setLinkTemplateSubject(e.target.checked)} className="accent-primary" />
                              <span className="truncate">Suggérer sur les tickets « {ticket.subject} »</span>
                            </label>
                          )}
                          <button onClick={saveTemplate}
                            disabled={!composeText.trim() || !newTemplateName.trim() || savingTemplate}
                            className="w-full py-2 text-xs rounded-lg bg-primary/10 text-primary-light
                                       border border-primary/20 hover:bg-primary/20
                                       disabled:opacity-40 transition-all font-semibold">
                            {savingTemplate ? 'Enregistrement...' : 'Enregistrer ce texte comme modèle'}
                          </button>
                        </div>
                    </div>
                  )}
                </div>

                {composeMode === 'reply' && (
                  <button onClick={() => setAnonymous(a => !a)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold
                                transition-all border ${anonymous
                                  ? 'bg-primary/10 text-primary-light border-primary/20'
                                  : 'bg-surface text-ink-3 border-overlay/[0.07] hover:text-ink-1 hover:border-overlay/12'}`}>
                    {anonymous ? <EyeOff size={11} /> : <Eye size={11} />}
                    {anonymous ? 'Anonyme' : 'Identifié'}
                  </button>
                )}
                {composeMode === 'reply' && (
                  <>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={pickFile} />
                    {replyFile ? (
                      <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border bg-primary/10 text-primary-light border-primary/20 max-w-[14rem]">
                        <Paperclip size={11} className="shrink-0" />
                        <span className="truncate" title={replyFile.name}>{replyFile.name}</span>
                        <button onClick={() => setReplyFile(null)} aria-label="Retirer le fichier" className="hover:text-ink-1"><X size={11} /></button>
                      </span>
                    ) : (
                      <button onClick={() => fileInputRef.current?.click()} title="Joindre un fichier (8 Mo max) — ou colle une capture, ou glisse un fichier sur la zone de texte"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-surface text-ink-3 border-overlay/[0.07] hover:text-ink-1 hover:border-overlay/12">
                        <Paperclip size={11} /> Fichier
                      </button>
                    )}
                  </>
                )}
              </div>

              <button onClick={handleSend} disabled={(!composeText.trim() && !(composeMode === 'reply' && replyFile)) || composeSending}
                className={`flex items-center gap-2 py-2 px-4 text-xs rounded-xl text-white font-semibold
                            transition-all disabled:opacity-40 ${composeMode === 'reply'
                              ? 'bg-primary hover:bg-primary-light shadow-lg shadow-primary/25'
                              : 'bg-surface-elevated hover:bg-surface-hover border border-overlay/10'}`}>
                <Send size={12} />
                {composeSending ? 'Envoi...' : composeMode === 'reply' ? 'Envoyer' : 'Ajouter'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════ Right column: sidebar (drawer below lg) ═════ */}
      {/* Embedded (split view): the column is always a drawer, the list takes the room */}
      {infoOpen && <div className={`fixed inset-0 z-30 bg-black/50 ${embedded ? '' : 'lg:hidden'}`} onClick={() => setInfoOpen(false)} />}
      <div className={`fixed inset-y-0 right-0 z-40 w-[85vw] max-w-sm bg-surface transition-transform
                      ${embedded ? '' : 'lg:sticky lg:top-0 lg:z-auto lg:w-72 lg:max-w-none lg:translate-x-0 lg:visible lg:bg-surface/60'}
                      shrink-0 h-screen overflow-y-auto border-l border-overlay/6 backdrop-blur-xs
                      ${infoOpen ? 'translate-x-0' : 'translate-x-full invisible'}`}>
        <div className="p-5 space-y-4">
          <div className={`flex justify-end ${embedded ? '' : 'lg:hidden'} -mb-2`}>
            <button onClick={() => setInfoOpen(false)} aria-label="Fermer le panneau"
              className="p-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/6"><X size={16} /></button>
          </div>

          {/* Confidential: who opened it (founders only) */}
          {ticket.visibility_grade_id === -1 && user?.role === 'fondateur' && (
            <div className={panelCard}>
              <SectionTitle>Consultations</SectionTitle>
              <ConfidentialAccess ticketId={ticket.id} />
            </div>
          )}

          {/* INFORMATIONS */}
          <div className={panelCard}>
            <SectionTitle>Informations</SectionTitle>
            <InfoRow icon={User}       label="Propriétaire"  value={ticket.owner_tag} />
            {user?.role === 'fondateur' && (
              <button onClick={() => navigate(`/members?id=${ticket.owner_id}`)} className="text-[10px] text-ink-4 hover:text-primary-light ml-9 -mt-1">
                Données du membre (RGPD) →
              </button>
            )}
            <InfoRow icon={Clock}      label="Créé le"       value={fmtDate(ticket.created_at, { dateStyle: 'medium', timeStyle: 'short' })} />
            {ticket.closed_at   && <InfoRow icon={CheckCircle2} label="Fermé le"     value={fmtDate(ticket.closed_at, { dateStyle: 'medium', timeStyle: 'short' })} />}
            {ticket.closed_by_tag && <InfoRow icon={User}    label="Fermé par"       value={ticket.closed_by_tag} />}
            {ticket.status === 'open' && <InfoRow icon={FolderOpen} label="Étape" value={currentStage?.label} />}

            <InfoRow icon={FileText} label="Titre (= nom du salon Discord)" value={ticket.subject || '—'} />
          </div>

          {/* ATTRIBUÉ À */}
          <div className={panelCard}>
            <SectionTitle>Attribué à</SectionTitle>
            {assignees.length === 0 ? (
              <p className="text-xs text-ink-4 italic mb-2">Personne — ticket libre</p>
            ) : (
              <ul className="space-y-1.5 mb-2">
                {assignees.map(a => (
                  <li key={a.user_id} className="flex items-center gap-2 rounded-lg bg-overlay/3 border border-overlay/6 px-2.5 py-1.5">
                    {a.avatar
                      ? <img src={`https://cdn.discordapp.com/avatars/${a.user_id}/${a.avatar}.webp?size=32`} alt="" className="w-5 h-5 rounded-full shrink-0" />
                      : <Users size={13} className="text-ink-3 shrink-0" />}
                    <span className="text-xs text-ink-1 truncate flex-1">{a.username}{a.user_id === user?.id && <span className="text-ink-4"> (toi)</span>}</span>
                    {ticket.status === 'open' && canAssign && (
                      <button onClick={() => removeAssignee(a.user_id)} disabled={claimLoading} title="Retirer"
                        className="text-ink-4 hover:text-red-400 disabled:opacity-50 shrink-0"><X size={12} /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {ticket.status === 'open' && canAssign && (
              <div className="space-y-1.5">
                {!amAssigned && (
                  <button onClick={() => addAssignee(user.id)} disabled={claimLoading}
                    className="w-full py-2 px-3 text-xs rounded-xl font-semibold border bg-emerald-500/10 text-emerald-400
                               border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-50">
                    M'attribuer le ticket
                  </button>
                )}
                {assignable.length > 0 && (
                  <div className="flex gap-1.5">
                    <Select className="flex-1 min-w-0" value={assigneeToAdd} onChange={setAssigneeToAdd}
                      placeholder="Attribuer à…"
                      options={[{ value: '', label: 'Attribuer à…' }, ...assignable.map(s => ({ value: s.user_id, label: `${s.username} · ${availabilityLabel(s)}` }))]} />
                    <button onClick={() => addAssignee(assigneeToAdd)} disabled={!assigneeToAdd || claimLoading} title="Attribuer" aria-label="Attribuer"
                      className="p-2 rounded-xl bg-surface border border-overlay/[0.07] text-ink-3 hover:text-ink-1
                                 hover:bg-surface-hover transition-all disabled:opacity-50 shrink-0">
                      <UserPlus size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ACTIONS */}
          {can('close_ticket') && (
            <div className={panelCard}>
              <SectionTitle>Actions</SectionTitle>
              <div className="space-y-2">
                {ticket.status === 'open' && (
                  <>
                    {user?.role === 'fondateur' && (
                      <button onClick={() => navigate(`/acces-invites?ticket=${ticket.id}`)}
                        className="w-full py-2 px-3 text-xs rounded-xl font-medium border border-overlay/8 text-ink-2 hover:text-ink-1 hover:bg-overlay/4 transition-all">
                        Partager avec un invité
                      </button>
                    )}
                    {can('close_ticket') && (
                      <button onClick={() => changeStatus('closed')} disabled={actionLoading}
                        className="w-full py-2.5 px-3 text-xs rounded-xl font-semibold transition-all
                                   disabled:opacity-50 border bg-red-500/10 text-red-400
                                   border-red-500/20 hover:bg-red-500/20">
                        {actionLoading ? 'En cours...' : 'Fermer le ticket'}
                      </button>
                    )}
                  </>
                )}
                {ticket.status === 'closed' && (
                  <button onClick={() => setShowReopenModal(true)} disabled={actionLoading}
                    className="w-full py-2.5 px-3 text-xs rounded-xl font-semibold transition-all
                               disabled:opacity-50 border bg-emerald-500/10 text-emerald-400
                               border-emerald-500/20 hover:bg-emerald-500/20">
                    {actionLoading ? 'En cours...' : 'Réouvrir le ticket'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* CHAMPS PERSONNALISÉS */}
          {ticket.fields?.length > 0 && (
            <div className={panelCard}>
              <SectionTitle>Informations</SectionTitle>
              <div className="space-y-2">
                {ticket.fields.map(f => (
                  <label key={f.id} className="block">
                    <span className="text-[10px] text-ink-4">{f.label}</span>
                    {can('reply_ticket') ? (
                      <input value={fieldEdits[f.id] ?? f.value ?? ''} onChange={e => setFieldEdits(v => ({ ...v, [f.id]: e.target.value }))}
                        inputMode={f.type === 'number' ? 'decimal' : undefined} maxLength={200}
                        className="w-full bg-surface border border-overlay/[0.07] text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary/50" />
                    ) : (
                      <p className="text-xs text-ink-2">{f.value || '—'}</p>
                    )}
                  </label>
                ))}
                {Object.keys(fieldEdits).length > 0 && (
                  <button onClick={saveFields} className="w-full py-1.5 text-xs rounded-lg font-semibold bg-primary/10 text-primary-light border border-primary/20 hover:bg-primary/20">
                    Enregistrer
                  </button>
                )}
              </div>
            </div>
          )}

          {/* LE MEMBRE (profil) */}
          {memberSummary && (
            <div className={panelCard}>
              <SectionTitle>Le membre</SectionTitle>
              <LabelChips labels={memberSummary.labels} size="text-[11px]" />
              {memberSummary.pinned.map(p => (
                <div key={p.id} className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5">
                  <p className="text-[11px] text-ink-1 whitespace-pre-wrap line-clamp-4"><Pin size={10} className="inline text-amber-400 mr-1" />{p.content}</p>
                  <p className="text-[10px] text-ink-4 mt-0.5">{p.author_tag} · {fmtDate(p.created_at, { dateStyle: 'short' })}</p>
                </div>
              ))}
              {memberSummary.latest.map(p => (
                <div key={p.id} className="mt-2 px-0.5">
                  <p className="text-[11px] text-ink-2 line-clamp-2">{p.content}</p>
                  <p className="text-[10px] text-ink-4">{p.author_tag} · {fmtDate(p.created_at, { dateStyle: 'short' })}</p>
                </div>
              ))}
              <button onClick={() => navigate(`/profils/${ticket.owner_id}`)} className="mt-2.5 text-[11px] font-medium text-primary-light hover:underline">
                {memberSummary.count ? `Voir le profil et les ${memberSummary.count} message(s)` : 'Voir le profil · ajouter une note'}
              </button>
            </div>
          )}

          {/* TEMPS PASSÉ */}
          <TimeTracker ticketId={ticketId} canTrack={can('reply_ticket')} open={ticket.status === 'open'} userId={user?.id}
            isFounder={user?.role === 'fondateur'} SectionTitle={SectionTitle} panelCard={panelCard} />

          {/* PROCÉDURES */}
          {procedures.map(proc => (
            <div key={proc.id} className={panelCard}>
              <SectionTitle>Procédure · {proc.title}</SectionTitle>
              <div className="flex items-center gap-2 mb-2.5" aria-label={`${proc.steps.filter(s => s.checked).length} étape(s) sur ${proc.total}`}>
                <span className="flex-1 h-1.5 rounded-full bg-overlay/8 overflow-hidden">
                  <span className="block h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.round(100 * proc.steps.filter(s => s.checked).length / Math.max(1, proc.total))}%` }} />
                </span>
                <span className="text-[11px] text-ink-3 tabular-nums">{proc.steps.filter(s => s.checked).length}/{proc.total}</span>
              </div>
              <ul className="space-y-1.5">
                {proc.steps.map(step => (
                  <li key={step.id}>
                    <label className={`flex items-start gap-2 text-xs ${can('reply_ticket') && ticket.status === 'open' ? 'cursor-pointer' : ''}`}>
                      <input type="checkbox" checked={step.checked} disabled={!can('reply_ticket') || ticket.status !== 'open'}
                        onChange={() => toggleStep(proc, step)} className="mt-0.5 accent-emerald-500" />
                      <span className={`${step.checked ? 'text-ink-3 line-through' : 'text-ink-1'}`}>
                        {step.text}
                        {step.checked && step.checked_by_tag && <span className="block text-[10px] text-ink-4 no-underline">{step.checked_by_tag} · {fmtDate(step.checked_at)}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* TICKETS SIMILAIRES */}
          {similar?.tickets?.length > 0 && (
            <div className={panelCard}>
              <SectionTitle>Tickets similaires</SectionTitle>
              <ul className="space-y-3">
                {similar.tickets.map(s => (
                  <li key={s.id} className="rounded-lg border border-overlay/6 bg-overlay/2 p-2.5 space-y-1.5">
                    <button onClick={() => navigate(`/tickets/${s.id}`)} className="text-left w-full">
                      <p className="text-xs font-medium text-ink-1 truncate"><span className="font-mono text-ink-4">#{s.id}</span> {s.subject || '—'}</p>
                      <p className="text-[10px] text-ink-4">
                        Résolu {s.closed_at ? `le ${fmtDate(s.closed_at, { dateStyle: 'short' })}` : ''}{s.closed_by_tag ? ` par ${s.closed_by_tag}` : ''}
                        {s.rating ? ` · ${'★'.repeat(s.rating)}` : ''}
                      </p>
                    </button>
                    {s.reply && (
                      <>
                        <p className="text-[11px] text-ink-2 line-clamp-3 whitespace-pre-wrap border-l-2 border-primary/40 pl-2">{s.reply.content}</p>
                        {ticket.status === 'open' && can('reply_ticket') && (
                          <button onClick={() => reuseReply(s.reply.content)}
                            className="text-[11px] font-medium text-primary-light hover:underline">Reprendre cette réponse</button>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* TICKETS LIÉS */}
          {(ticket.links?.length > 0 || can('reply_ticket')) && (
            <div className={panelCard}>
              <SectionTitle>Tickets liés</SectionTitle>
              {ticket.links?.length > 0 && (
                <ul className="space-y-1 mb-2">
                  {ticket.links.map(l => (
                    <li key={l.id} className="flex items-center gap-1.5 text-xs">
                      <Link2 size={11} className="text-ink-4 shrink-0" />
                      <button onClick={() => navigate(`/tickets/${l.id}`)} className="flex-1 min-w-0 text-left truncate text-ink-2 hover:text-primary-light">
                        #{l.id} — {l.subject || 'Sans sujet'} <span className="text-ink-4">· {l.owner_tag}{l.status === 'closed' ? ' · fermé' : ''}</span>
                      </button>
                      {can('reply_ticket') && <button onClick={() => removeLink(l.id)} aria-label={`Retirer le lien avec #${l.id}`} className="text-ink-4 hover:text-red-400"><X size={11} /></button>}
                    </li>
                  ))}
                </ul>
              )}
              {can('reply_ticket') && (
                <div className="flex gap-1.5">
                  <input value={linkInput} onChange={e => setLinkInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addLink()}
                    placeholder="N° de ticket" inputMode="numeric" aria-label="Numéro du ticket à lier"
                    className="flex-1 min-w-0 bg-surface border border-overlay/[0.07] text-ink-1 placeholder-ink-4 rounded-xl px-2.5 py-2 text-xs focus:outline-hidden focus:border-primary/50" />
                  <button onClick={addLink} className="px-2.5 rounded-xl text-xs text-ink-3 border border-overlay/[0.07] hover:text-ink-1 hover:bg-overlay/4">Lier</button>
                </div>
              )}
            </div>
          )}

          {/* RAPPELS */}
          <div className={panelCard}>
            <SectionTitle>Me le rappeler</SectionTitle>
            <input value={reminderNote} onChange={e => setReminderNote(e.target.value)} maxLength={200} placeholder="Note (optionnel)"
              aria-label="Note du rappel"
              className="w-full bg-surface border border-overlay/[0.07] text-ink-1 placeholder-ink-4 rounded-xl px-2.5 py-2 text-xs focus:outline-hidden focus:border-primary/50 mb-2" />
            <div className="grid grid-cols-3 gap-1.5">
              {[['1h', 'Dans 1 h'], ['4h', 'Dans 4 h'], ['1d', 'Demain'], ['2d', 'Dans 2 j'], ['1w', 'Dans 1 sem.']].map(([v, label]) => (
                <button key={v} onClick={() => addReminder(v)}
                  className="py-1.5 rounded-lg text-[11px] text-ink-3 border border-overlay/[0.07] hover:text-ink-1 hover:bg-overlay/4">{label}</button>
              ))}
            </div>
            {reminders.filter(r => !r.sent_at).length > 0 && (
              <ul className="mt-2.5 space-y-1">
                {reminders.filter(r => !r.sent_at).map(r => (
                  <li key={r.id} className="flex items-center gap-1.5 text-[11px] text-ink-2">
                    <AlarmClock size={11} className="text-primary-light shrink-0" />
                    <span className="flex-1 truncate">{fmtDate(r.remind_at, { dateStyle: 'short', timeStyle: 'short' })}{r.note ? ` · ${r.note}` : ''}</span>
                    <button onClick={() => removeReminder(r.id)} aria-label="Supprimer le rappel" className="text-ink-4 hover:text-red-400"><X size={11} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* FUSION */}
          {ticket.merged_into && (
            <div className={panelCard}>
              <SectionTitle>Fusion</SectionTitle>
              <p className="text-xs text-ink-2">
                Fusionné dans{' '}
                <button onClick={() => navigate(`/tickets/${ticket.merged_into}`)} className="text-primary-light hover:underline font-semibold">
                  #{ticket.merged_into}
                </button>
              </p>
            </div>
          )}
          {ticket.status === 'open' && can('close_ticket') && can('reply_ticket') && (
            <div className={panelCard}>
              <SectionTitle>Fusionner</SectionTitle>
              {mergeCandidates === null ? (
                <button onClick={loadMergeCandidates}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs rounded-xl border border-overlay/[0.07] text-ink-3 hover:text-ink-1 hover:bg-overlay/4">
                  <GitMerge size={12} /> Fusionner avec un autre ticket du membre
                </button>
              ) : mergeCandidates.length === 0 ? (
                <p className="text-[11px] text-ink-4">Ce membre n'a pas d'autre ticket ouvert.</p>
              ) : (
                <div className="space-y-2">
                  <select value={mergeTarget} onChange={e => setMergeTarget(e.target.value)} aria-label="Ticket cible"
                    className="w-full bg-surface border border-overlay/[0.07] text-ink-1 rounded-xl px-2.5 py-2 text-xs focus:outline-hidden focus:border-primary/50">
                    {mergeCandidates.map(c => (
                      <option key={c.id} value={c.id}>#{c.id} — {c.subject || 'Sans sujet'}</option>
                    ))}
                  </select>
                  <button onClick={mergeInto} disabled={merging || !mergeTarget}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs rounded-xl font-semibold border bg-primary/10 text-primary-light border-primary/20 hover:bg-primary/20 disabled:opacity-50">
                    <GitMerge size={12} /> {merging ? 'Fusion…' : 'Fusionner ce ticket dans la cible'}
                  </button>
                  <p className="text-[10px] text-ink-4">Ce ticket est fermé et son contenu rejoint la cible ; le membre est prévenu.</p>
                </div>
              )}
            </div>
          )}

          {/* PRIORITÉ */}
          <div className={panelCard}>
            <SectionTitle>Priorité</SectionTitle>
            <div className="flex gap-1.5">
              {['low', 'normal', 'urgent'].map(p => (
                <button key={p} onClick={() => changePriority(p)}
                  disabled={saving || ticket.priority === p || ticket.status !== 'open' || !can('reply_ticket')}
                  className={`flex-1 py-2 px-2 text-xs rounded-xl font-semibold transition-all
                              disabled:cursor-not-allowed border ${ticket.priority === p
                                ? PRIORITY_ACTIVE[p]
                                : 'bg-surface text-ink-3 border-overlay/6 hover:bg-surface-hover hover:text-ink-1 hover:border-overlay/10'}`}>
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* PARTICIPANTS */}
          <div className={panelCard}>
            <SectionTitle>Participants ({1 + (ticket.participants?.length || 0)})</SectionTitle>
            <div className="space-y-1.5 mb-3">
              <div className="flex items-center justify-between px-3 py-2 rounded-xl
                              bg-primary/8 border border-primary/15">
                <div className="min-w-0">
                  <p className="text-xs text-ink-1 font-semibold truncate">{ticket.owner_tag}</p>
                  <p className="text-[10px] text-ink-4 font-mono mt-0.5">{ticket.owner_id}</p>
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wide text-primary-light
                                 bg-primary/10 px-1.5 py-0.5 rounded-md shrink-0 ml-2 border border-primary/20">
                  Auteur
                </span>
              </div>
              {ticket.participants?.map(p => (
                <div key={p.id}
                  className="group flex items-center justify-between px-3 py-2 rounded-xl
                             bg-surface border border-overlay/6 hover:border-overlay/10 transition-colors">
                  <div className="min-w-0">
                    <p className="text-xs text-ink-1 font-semibold truncate">{p.tag}</p>
                    <p className="text-[10px] text-ink-4 font-mono mt-0.5">{p.id}</p>
                  </div>
                  {ticket.status === 'open' && can('manage_participants') && (
                    <button onClick={() => removeParticipant(p.id)} aria-label="Retirer le participant"
                      className="focus-visible:opacity-100 text-ink-4 hover:text-red-400 transition-colors
                                 opacity-0 group-hover:opacity-100 ml-2 shrink-0">
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {ticket.status === 'open' && can('manage_participants') && (
              <div className="flex gap-1.5">
                <input type="text" value={newParticipantId}
                  onChange={e => setNewParticipantId(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addParticipant(); }}
                  placeholder="Discord ID..."
                  className="flex-1 min-w-0 bg-surface border border-overlay/[0.07] text-ink-1
                             placeholder-ink-4 rounded-xl px-2.5 py-2 text-xs focus:outline-hidden
                             focus:border-primary/50 font-mono transition-all" />
                <button onClick={addParticipant} aria-label="Ajouter le participant"
                  disabled={!newParticipantId.trim() || addingParticipant}
                  className="p-2 rounded-xl bg-surface border border-overlay/[0.07] text-ink-3
                             hover:text-ink-1 hover:bg-surface-hover hover:border-overlay/12
                             transition-all disabled:opacity-50 shrink-0">
                  <UserPlus size={14} />
                </button>
              </div>
            )}
          </div>

          {/* ÉTAPE */}
          {ticket.status === 'open' && can('reply_ticket') && (
            <div className={panelCard}>
              <SectionTitle>Étape</SectionTitle>
              <div className="grid grid-cols-3 gap-1.5">
                {STAGES.map(st => {
                  const active = (ticket.stage || 'open') === st.value;
                  const configured = ticket.stages?.[st.value] !== false;
                  return (
                    <button key={st.value} onClick={() => moveTicket(st.value)}
                      disabled={movingTicket || active || !configured}
                      title={configured ? `Passer en « ${st.label} »` : 'Aucune catégorie Discord associée (Paramètres)'}
                      className={`py-2 px-1 rounded-xl text-[11px] font-semibold border transition-all disabled:cursor-default
                                  ${active ? st.cls : 'text-ink-3 border-overlay/[0.07] hover:text-ink-1 hover:bg-overlay/4'}
                                  ${!configured ? 'opacity-40' : ''}`}>
                      {st.label}
                    </button>
                  );
                })}
              </div>
              {ticket.stage_changed_at && (
                <p className="text-[10px] text-ink-4 mt-2">
                  Dans cette étape depuis {fmtMinutes(Math.max(0, Math.floor((Date.now() - new Date(ticket.stage_changed_at).getTime()) / 60000)))}
                  {ticket.sla ? ` · délai ${ticket.sla.hours} h` : ''}
                </p>
              )}
              {ticket.sla && <div className="mt-1.5"><SlaBadge sla={ticket.sla} bar /></div>}
            </div>
          )}

          {/* VISIBILITÉ */}
          {(grades.length > 0 || user?.role === 'fondateur') && can('manage_grades') && (
            <div className={panelCard}>
              <SectionTitle>Visibilité</SectionTitle>
              <select value={ticket.visibility_grade_id || ''} onChange={e => changeVisibility(e.target.value || null)} aria-label="Visibilité du ticket"
                disabled={savingVisibility}
                className="w-full bg-surface border border-overlay/[0.07] text-ink-1 rounded-xl px-2.5 py-2
                           text-xs focus:outline-hidden focus:border-primary/50 transition-all disabled:opacity-50">
                <option value="">Tous les membres du staff</option>
                {grades.map(g => (
                  <option key={g.id} value={g.id}>{g.name} et supérieurs</option>
                ))}
                {user?.role === 'fondateur' && <option value="-1">🔒 Confidentiel (fondateurs uniquement)</option>}
              </select>
              {ticket.visibility_grade_id > 0 && (
                <p className="text-[10px] text-amber-400 mt-2">
                  Ticket restreint — visible uniquement par certains grades, sur le dashboard comme sur Discord.
                </p>
              )}
            </div>
          )}

          {/* TAGS */}
          <div className={panelCard}>
            <SectionTitle>Tags</SectionTitle>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {ticketTags.map(tag => (
                <span key={tag.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold border"
                  style={{ backgroundColor: `${tag.color}18`, color: tag.color, borderColor: `${tag.color}35` }}>
                  {tag.name}
                  {can('reply_ticket') && (
                    <button onClick={() => removeTagFromTicket(tag.id)}
                      className="ml-0.5 hover:opacity-70 transition-opacity">
                      <X size={9} />
                    </button>
                  )}
                </span>
              ))}
              {ticketTags.length === 0 && <span className="text-xs text-ink-4 italic">Aucun tag</span>}
            </div>
            {can('reply_ticket') && allTags.filter(t => !ticketTags.find(tt => tt.id === t.id)).length > 0 && (
              <select defaultValue=""
                onChange={e => { if (e.target.value) { addTagToTicket(parseInt(e.target.value)); e.target.value = ''; } }}
                className="w-full bg-surface border border-overlay/[0.07] text-ink-1 rounded-xl px-2.5 py-1.5
                           text-xs focus:outline-hidden focus:border-primary/50 transition-all">
                <option value="">+ Ajouter un tag...</option>
                {allTags.filter(t => !ticketTags.find(tt => tt.id === t.id)).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* SATISFACTION */}
          {ticket.rating && (
            <div className={panelCard}>
              <SectionTitle>Satisfaction</SectionTitle>
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map(i => (
                    <Star key={i} size={15}
                      fill={i <= ticket.rating.rating ? '#f59e0b' : 'none'}
                      className={i <= ticket.rating.rating ? 'text-amber-400' : 'text-ink-4'} />
                  ))}
                </div>
                <span className="text-sm text-ink-1 font-bold tabular-nums">{ticket.rating.rating}/5</span>
              </div>
              <p className="text-[10px] text-ink-4 mt-1.5">
                {fmtDate(ticket.rating.rated_at, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
              {ticket.rating.comment && (
                <blockquote className="mt-2.5 pl-2.5 border-l-2 border-amber-400/40 text-xs text-ink-2 whitespace-pre-wrap wrap-break-word">
                  {ticket.rating.comment}
                </blockquote>
              )}
              {ticket.status === 'closed' && ticket.lowRatingThreshold > 0 && ticket.rating.rating <= ticket.lowRatingThreshold && can('reply_ticket') && (
                ticket.followup_at ? (
                  <p className="text-[10px] text-emerald-400 mt-2.5">
                    Membre recontacté par {ticket.followup_by_tag} · {fmtDate(ticket.followup_at, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] text-amber-300">Note basse : recontacte le membre (MP, avec le bouton « Rouvrir » s'il est encore possible).</p>
                    <textarea value={followupText} onChange={e => setFollowupText(e.target.value)} rows={3} maxLength={2000}
                      placeholder="Bonjour, nous avons vu ta note…" aria-label="Message de suivi"
                      className="w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2 text-xs focus:outline-hidden focus:border-primary/50 resize-none" />
                    <button onClick={sendFollowup} disabled={!followupText.trim() || sendingFollowup}
                      className="w-full py-2 text-xs rounded-xl font-semibold border bg-primary/10 text-primary-light border-primary/20 hover:bg-primary/20 disabled:opacity-50">
                      {sendingFollowup ? 'Envoi…' : 'Recontacter le membre'}
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          {/* TRANSCRIPT */}
          {ticket.transcript && can('view_transcripts') && (
            <div className={panelCard}>
              <SectionTitle>Transcript</SectionTitle>
              <p className="text-[10px] text-ink-4 mb-3">
                {ticket.transcript.message_count} messages · {ticket.transcript.created_by_tag}
              </p>
              <div className="flex flex-col gap-1.5">
                <a href={`/api/transcripts/${ticket.transcript.id}/html`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 py-2 px-3 text-xs rounded-xl bg-primary/10 text-primary-light
                             border border-primary/20 hover:bg-primary/20 transition-colors font-semibold">
                  <FileText size={12} /> Voir HTML
                </a>
                <a href={`/api/transcripts/${ticket.transcript.id}/txt`}
                  className="flex items-center gap-2 py-2 px-3 text-xs rounded-xl bg-surface text-ink-2
                             border border-overlay/[0.07] hover:bg-surface-hover hover:border-overlay/12
                             transition-colors font-semibold">
                  Télécharger .txt
                </a>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
