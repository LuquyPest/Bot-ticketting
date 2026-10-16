import React, { useEffect, useState, useCallback, useRef} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Star, FileText, User, Clock, X, Send,
  MessageSquare, Reply, UserPlus, FolderOpen, Pencil,
  Lock, CheckCircle2, Eye, EyeOff, Layers, Check, ChevronDown, History, Users
} from 'lucide-react';
import api from '../api';
import Badge from '../components/Badge';
import Select from '../components/Select';
import toast from 'react-hot-toast';
import { fmtDate } from '../utils/format';
import { useAuth } from '../App';
import { useSSE } from '../hooks/useSSE';

const TEMPLATE_VAR_RE = /\{\{(username|ticket_id|date|staff_name|subject)\}\}/gi;

function hasVars(text) { return TEMPLATE_VAR_RE.test(text); }

function resolveVars(text, ticket, staffUsername) {
  const date = new Date().toLocaleDateString('fr-FR');
  return text
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
    <div className="flex items-start gap-2.5 py-2 border-b border-white/[0.04] last:border-0">
      <div className="w-6 h-6 rounded-lg bg-white/[0.04] flex items-center justify-center flex-shrink-0 mt-0.5">
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
  if (source === 'web')  return 'center';
  return 'right';
}

function getBubbleStyle(source) {
  if (source === 'user') return {
    bubble: 'bg-surface-card text-ink-2 border border-white/[0.08]',
    avatar: 'from-violet-500 to-violet-700',
    label: null,
  };
  if (source === 'reply') return {
    bubble: 'bg-gradient-to-br from-primary to-indigo-600 text-white shadow-lg shadow-primary/20',
    avatar: 'from-primary to-indigo-600',
    label: 'Réponse',
  };
  if (source === 'discord') return {
    bubble: 'bg-surface-elevated text-ink-2 border border-white/[0.08]',
    avatar: 'from-surface-hover to-surface-elevated',
    label: 'Discord',
  };
  return null;
}

function DiscordAvatar({ authorId, authorAvatar, authorTag, gradient }) {
  const avatarUrl = authorId && authorAvatar
    ? `https://cdn.discordapp.com/avatars/${authorId}/${authorAvatar}.webp?size=64`
    : null;

  const base = 'w-8 h-8 rounded-full shadow-md flex-shrink-0 mb-1';

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
    <div className={`${base} bg-gradient-to-br ${gradient}
                     flex items-center justify-center text-xs font-bold text-white`}>
      {authorTag?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────── */
export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [replyText, setReplyText] = useState('');
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
    api.get('/templates').then(r => setTemplates(r.data)).catch(() => {});
    api.get('/grades').then(r => setGrades(r.data)).catch(() => {});
    api.get('/tags').then(r => setAllTags(r.data)).catch(() => {});
    api.get(`/tags/ticket/${id}`).then(r => setTicketTags(r.data)).catch(() => {});
    localStorage.setItem(`ticket_seen_${id}`, Date.now().toString());
  }, [loadTicket, loadNotes, id]);

  useEffect(() => {
    if (!ticket?.subject) return;
    api.get('/templates', { params: { subject: ticket.subject } }).then(r => setTemplates(r.data)).catch(() => {});
  }, [ticket?.subject]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [notes]);

  useSSE({
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
      if (e.key === 'Escape') { navigate('/tickets'); return; }
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
      await api.post(`/tickets/${id}/notes`, { content: newNote.trim() });
      setNewNote('');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSavingNote(false); }
  };

  const sendReply = async () => {
    if (!replyText.trim()) return;
    setSendingReply(true);
    try {
      await api.post(`/tickets/${id}/reply`, { content: replyText.trim(), anonymous });
      setReplyText('');
      toast.success('Réponse envoyée');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSendingReply(false); }
  };

  const addAssignee = async (userId) => {
    if (!userId) return;
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

  const moveTicket = async (stage) => {
    if (stage === ticket.stage) return;
    setMovingTicket(true);
    try {
      const { data } = await api.patch(`/tickets/${id}/move`, { stage });
      setTicket(t => ({ ...t, stage: data.stage }));
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

  const deleteNote = async (noteId) => {
    try {
      await api.delete(`/tickets/${id}/notes/${noteId}`);
      setNotes(n => n.filter(x => x.id !== noteId));
    } catch { toast.error('Erreur lors de la suppression'); }
  };

  const saveTemplate = async () => {
    if (!composeText.trim() || !newTemplateName.trim()) return;
    setSavingTemplate(true);
    try {
      const { data } = await api.post('/templates', {
        name: newTemplateName.trim(), content: composeText.trim(),
        subject: ticket?.subject || null
      });
      setTemplates(t => [...t, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTemplateName('');
      toast.success('Template sauvegardé');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSavingTemplate(false); }
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
  const panelCard = 'bg-white/[0.025] rounded-xl border border-white/[0.06] p-4';

  return (
    <div className="flex flex-1 min-h-screen overflow-hidden">

      {/* ── Modal: réouvrir ─────────────────────────────────── */}
      {showReopenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="bg-surface-card border border-white/[0.1] rounded-2xl p-6 w-full max-w-sm
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
                  className="w-full bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4
                             rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-primary/50
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
          <div className="bg-surface-card border border-white/[0.1] rounded-2xl p-6 w-full max-w-lg
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
                             hover:bg-white/[0.04] text-left transition-colors">
                  <div className="min-w-0">
                    <span className="text-xs text-ink-4 font-mono mr-2 tabular-nums">#{t.id}</span>
                    <span className="text-sm text-ink-2">{t.subject || 'Sans sujet'}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
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
        <div className="sticky top-0 z-10 glass-dark border-b border-white/[0.06]
                        px-5 py-3 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => navigate('/tickets')}
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-white/[0.06]
                       transition-all flex-shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="h-4 w-px bg-white/[0.08] flex-shrink-0" />
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
                           rounded-lg px-2.5 py-1 text-sm focus:outline-none" />
              <button onClick={() => saveSubject().then(ok => ok && setEditingTitle(false))} disabled={savingSubject}
                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50 flex-shrink-0" title="Enregistrer"><Check size={15} /></button>
              <button onClick={() => setEditingTitle(false)} className="text-ink-4 hover:text-ink-2 flex-shrink-0" title="Annuler"><X size={15} /></button>
            </div>
          ) : can('reply_ticket') ? (
            <button onClick={() => { setSubjectInput(ticket.subject || ''); setEditingTitle(true); }}
              title="Modifier le titre"
              className="group flex items-center gap-1.5 min-w-0 text-sm text-ink-2 hover:text-ink-1">
              <span className="truncate max-w-xs">{ticket.subject || <span className="italic text-ink-4">Ajouter un titre</span>}</span>
              <Pencil size={12} className="text-ink-4 group-hover:text-ink-2 flex-shrink-0" />
            </button>
          ) : ticket.subject && (
            <span className="text-sm text-ink-2 truncate max-w-xs">{ticket.subject}</span>
          )}

          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            <button onClick={loadUserHistory}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                         text-ink-3 hover:text-ink-1 hover:bg-white/[0.06] border border-white/[0.07]
                         transition-all">
              <History size={12} /> Historique
            </button>
            <a href={`/api/tickets/${id}/pdf`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                         text-ink-3 hover:text-ink-1 hover:bg-white/[0.06] border border-white/[0.07]
                         transition-all">
              <FileText size={12} /> PDF
            </a>
            {ticket.created_at && (
              <span className="text-xs text-ink-4 tabular-nums">
                {fmtDate(ticket.created_at, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {notes.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-20">
              <div className="w-14 h-14 rounded-2xl bg-surface-card border border-white/[0.07]
                              flex items-center justify-center">
                <MessageSquare size={22} className="text-ink-4" />
              </div>
              <p className="text-sm font-semibold text-ink-3">Aucun message</p>
              <p className="text-xs text-ink-4">Les messages apparaîtront ici.</p>
            </div>
          )}

          {notes.map(note => {
            const align = getBubbleAlign(note.source);

            /* Internal note */
            if (align === 'center') {
              return (
                <div key={note.id} className="flex justify-center group animate-fade-in">
                  <div className="flex items-start gap-2 max-w-md px-4 py-2.5 rounded-xl
                                  bg-surface border border-dashed border-white/[0.08]">
                    <Lock size={10} className="text-ink-4 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-ink-2 leading-relaxed whitespace-pre-wrap break-words">
                        {note.content}
                      </p>
                      <p className="text-[10px] text-ink-4 mt-1.5">
                        {note.author_tag} · {fmtDate(note.created_at)}
                      </p>
                    </div>
                    {canDeleteNote(note) && (
                      <button onClick={() => deleteNote(note.id)}
                        className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-red-400
                                   transition-all flex-shrink-0 mt-0.5">
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
              <div key={note.id}
                className={`flex items-end gap-2.5 group animate-fade-in
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

                  <div className={`relative px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                                   whitespace-pre-wrap break-words max-w-sm ${style.bubble}
                                   ${isLeft ? 'rounded-tl-md' : 'rounded-tr-md'}`}>
                    {note.content}
                  </div>

                  <div className={`flex items-center gap-2 px-0.5 ${isLeft ? '' : 'flex-row-reverse'}`}>
                    <span className="text-[10px] text-ink-4 tabular-nums">{fmtDate(note.created_at)}</span>
                    {canDeleteNote(note) && (
                      <button onClick={() => deleteNote(note.id)}
                        className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-red-400
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
          <div className="border-t border-white/[0.06] glass-dark px-5 py-4 flex-shrink-0">
            {/* Mode toggle */}
            <div className="flex gap-0.5 mb-3 bg-surface rounded-xl p-1 w-fit border border-white/[0.06]">
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
                              ? 'bg-surface-elevated text-ink-1 shadow-sm'
                              : 'text-ink-3 hover:text-ink-2'}`}>
                <Lock size={11} />
                Note interne
              </button>
            </div>

            {/* Textarea */}
            <textarea
              ref={replyRef}
              value={composeText}
              onChange={e => setComposeText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSend(); }}
              placeholder={composeMode === 'reply'
                ? 'Répondre à l\'utilisateur... (Ctrl+Entrée)'
                : 'Note interne (non visible par l\'utilisateur)...'}
              rows={3}
              maxLength={2000}
              className={`w-full bg-surface border text-ink-1 placeholder-ink-4 rounded-xl px-4 py-3
                          text-sm focus:outline-none resize-none transition-all
                          ${composeMode === 'reply'
                            ? 'border-primary/30 focus:border-primary/60 focus:ring-1 focus:ring-primary/20'
                            : 'border-white/[0.07] focus:border-white/[0.12]'}`}
            />

            {/* Footer */}
            <div className="flex items-center justify-between mt-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-ink-4 tabular-nums">{composeText.length}/2000</span>
                <span className="text-[10px] text-ink-4 hidden sm:block">
                  <kbd className="px-1 py-0.5 rounded bg-surface border border-white/[0.07] font-mono text-[9px]">R</kbd> répondre ·{' '}
                  <kbd className="px-1 py-0.5 rounded bg-surface border border-white/[0.07] font-mono text-[9px]">N</kbd> note ·{' '}
                  <kbd className="px-1 py-0.5 rounded bg-surface border border-white/[0.07] font-mono text-[9px]">ESC</kbd> retour
                </span>

                {/* Templates */}
                <div className="relative" ref={templatesRef}>
                  <button onClick={() => setShowTemplates(t => !t)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                               border bg-surface text-ink-3 border-white/[0.07]
                               hover:text-ink-1 hover:border-white/[0.12] transition-all">
                    <Layers size={11} />
                    Templates
                    <ChevronDown size={10} className={`transition-transform duration-200 ${showTemplates ? 'rotate-180' : ''}`} />
                  </button>
                  {showTemplates && (
                    <div className="absolute bottom-full mb-2 left-0 z-20 w-72 bg-surface-elevated
                                    border border-white/[0.1] rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.7)]
                                    overflow-hidden animate-in">
                      <div className="max-h-52 overflow-y-auto">
                        {templates.length === 0 ? (
                          <p className="text-xs text-ink-4 p-4 text-center">Aucun template sauvegardé</p>
                        ) : templates.map(tpl => (
                          <div key={tpl.id}
                            className="group/tpl flex items-start gap-2 px-3.5 py-2.5
                                       hover:bg-white/[0.04] border-b border-white/[0.05] last:border-0
                                       transition-colors cursor-pointer"
                            onClick={() => {
                              setComposeText(resolveVars(tpl.content, ticket, user?.username));
                              setShowTemplates(false);
                            }}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-semibold text-ink-1 truncate">{tpl.name}</p>
                                {hasVars(tpl.content) && (
                                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-violet-500/20
                                                   text-violet-300 border border-violet-500/20 flex-shrink-0">
                                    vars
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-ink-3 truncate mt-0.5">
                                {resolveVars(tpl.content, ticket, user?.username)}
                              </p>
                            </div>
                            {(user?.role === 'fondateur' || tpl.created_by_id === user?.id) && (
                              <button onClick={(e) => deleteTemplate(tpl.id, e)}
                                className="opacity-0 group-hover/tpl:opacity-100 text-ink-4
                                           hover:text-red-400 transition-all flex-shrink-0 mt-0.5">
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {user?.role === 'fondateur' && (
                        <div className="border-t border-white/[0.07] px-3.5 py-2.5 space-y-2 bg-white/[0.02]">
                          <input type="text" placeholder="Nom du template..."
                            value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)}
                            className="w-full bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4
                                       rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary/50
                                       transition-all" />
                          <button onClick={saveTemplate}
                            disabled={!composeText.trim() || !newTemplateName.trim() || savingTemplate}
                            className="w-full py-2 text-xs rounded-lg bg-primary/10 text-primary-light
                                       border border-primary/20 hover:bg-primary/20
                                       disabled:opacity-40 transition-all font-semibold">
                            {savingTemplate ? 'Sauvegarde...' : 'Sauvegarder ce texte'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {composeMode === 'reply' && (
                  <button onClick={() => setAnonymous(a => !a)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold
                                transition-all border ${anonymous
                                  ? 'bg-primary/10 text-primary-light border-primary/20'
                                  : 'bg-surface text-ink-3 border-white/[0.07] hover:text-ink-1 hover:border-white/[0.12]'}`}>
                    {anonymous ? <EyeOff size={11} /> : <Eye size={11} />}
                    {anonymous ? 'Anonyme' : 'Identifié'}
                  </button>
                )}
              </div>

              <button onClick={handleSend} disabled={!composeText.trim() || composeSending}
                className={`flex items-center gap-2 py-2 px-4 text-xs rounded-xl text-white font-semibold
                            transition-all disabled:opacity-40 ${composeMode === 'reply'
                              ? 'bg-primary hover:bg-primary-light shadow-lg shadow-primary/25'
                              : 'bg-surface-elevated hover:bg-surface-hover border border-white/[0.1]'}`}>
                <Send size={12} />
                {composeSending ? 'Envoi...' : composeMode === 'reply' ? 'Envoyer' : 'Ajouter'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════ Right column: sidebar ═════════════════ */}
      <div className="w-72 flex-shrink-0 sticky top-0 h-screen overflow-y-auto
                      border-l border-white/[0.06] bg-[#09090f]/60 backdrop-blur-sm">
        <div className="p-5 space-y-4">

          {/* INFORMATIONS */}
          <div className={panelCard}>
            <SectionTitle>Informations</SectionTitle>
            <InfoRow icon={User}       label="Propriétaire"  value={ticket.owner_tag} />
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
                  <li key={a.user_id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5">
                    {a.avatar
                      ? <img src={`https://cdn.discordapp.com/avatars/${a.user_id}/${a.avatar}.webp?size=32`} alt="" className="w-5 h-5 rounded-full flex-shrink-0" />
                      : <Users size={13} className="text-ink-3 flex-shrink-0" />}
                    <span className="text-xs text-ink-1 truncate flex-1">{a.username}{a.user_id === user?.id && <span className="text-ink-4"> (toi)</span>}</span>
                    {ticket.status === 'open' && canAssign && (
                      <button onClick={() => removeAssignee(a.user_id)} disabled={claimLoading} title="Retirer"
                        className="text-ink-4 hover:text-red-400 disabled:opacity-50 flex-shrink-0"><X size={12} /></button>
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
                      options={[{ value: '', label: 'Attribuer à…' }, ...assignable.map(s => ({ value: s.user_id, label: s.username }))]} />
                    <button onClick={() => addAssignee(assigneeToAdd)} disabled={!assigneeToAdd || claimLoading} title="Attribuer"
                      className="p-2 rounded-xl bg-surface border border-white/[0.07] text-ink-3 hover:text-ink-1
                                 hover:bg-surface-hover transition-all disabled:opacity-50 flex-shrink-0">
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
                                : 'bg-surface text-ink-3 border-white/[0.06] hover:bg-surface-hover hover:text-ink-1 hover:border-white/[0.1]'}`}>
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
                                 bg-primary/10 px-1.5 py-0.5 rounded-md flex-shrink-0 ml-2 border border-primary/20">
                  Auteur
                </span>
              </div>
              {ticket.participants?.map(p => (
                <div key={p.id}
                  className="group flex items-center justify-between px-3 py-2 rounded-xl
                             bg-surface border border-white/[0.06] hover:border-white/[0.1] transition-colors">
                  <div className="min-w-0">
                    <p className="text-xs text-ink-1 font-semibold truncate">{p.tag}</p>
                    <p className="text-[10px] text-ink-4 font-mono mt-0.5">{p.id}</p>
                  </div>
                  {ticket.status === 'open' && can('manage_participants') && (
                    <button onClick={() => removeParticipant(p.id)}
                      className="text-ink-4 hover:text-red-400 transition-colors
                                 opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0">
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
                  className="flex-1 min-w-0 bg-surface border border-white/[0.07] text-ink-1
                             placeholder-ink-4 rounded-xl px-2.5 py-2 text-xs focus:outline-none
                             focus:border-primary/50 font-mono transition-all" />
                <button onClick={addParticipant}
                  disabled={!newParticipantId.trim() || addingParticipant}
                  className="p-2 rounded-xl bg-surface border border-white/[0.07] text-ink-3
                             hover:text-ink-1 hover:bg-surface-hover hover:border-white/[0.12]
                             transition-all disabled:opacity-50 flex-shrink-0">
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
                                  ${active ? st.cls : 'text-ink-3 border-white/[0.07] hover:text-ink-1 hover:bg-white/[0.04]'}
                                  ${!configured ? 'opacity-40' : ''}`}>
                      {st.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* VISIBILITÉ */}
          {grades.length > 0 && can('manage_grades') && (
            <div className={panelCard}>
              <SectionTitle>Visibilité</SectionTitle>
              <select value={ticket.visibility_grade_id || ''} onChange={e => changeVisibility(e.target.value || null)}
                disabled={savingVisibility}
                className="w-full bg-surface border border-white/[0.07] text-ink-1 rounded-xl px-2.5 py-2
                           text-xs focus:outline-none focus:border-primary/50 transition-all disabled:opacity-50">
                <option value="">Tous les membres du staff</option>
                {grades.map(g => (
                  <option key={g.id} value={g.id}>{g.name} et supérieurs</option>
                ))}
              </select>
              {ticket.visibility_grade_id && (
                <p className="text-[10px] text-amber-400/80 mt-2">
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
                className="w-full bg-surface border border-white/[0.07] text-ink-1 rounded-xl px-2.5 py-1.5
                           text-xs focus:outline-none focus:border-primary/50 transition-all">
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
                <blockquote className="mt-2.5 pl-2.5 border-l-2 border-amber-400/40 text-xs text-ink-2 whitespace-pre-wrap break-words">
                  {ticket.rating.comment}
                </blockquote>
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
                             border border-white/[0.07] hover:bg-surface-hover hover:border-white/[0.12]
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
