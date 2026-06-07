import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Star, FileText, User, Clock, X, Send,
  MessageSquare, Reply, UserPlus, FolderOpen, Pencil,
  Lock, CheckCircle2, Eye, EyeOff, Layers, Check, AlertTriangle, UserCircle
} from 'lucide-react';
import api from '../api';
import Badge from '../components/Badge';
import toast from 'react-hot-toast';
import { fmtDate } from '../utils/format';
import { useAuth } from '../App';
import { useSSE } from '../hooks/useSSE';

const PRIORITY_LABELS = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };

const PRIORITY_ACTIVE = {
  low:    'bg-sky-600/20 text-sky-400 border-sky-600/30',
  normal: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
  urgent: 'bg-red-600/20 text-red-400 border-red-600/30'
};

function SectionTitle({ children }) {
  return (
    <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-2">{children}</p>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1">
      <Icon size={12} className="text-slate-600 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] text-slate-600 leading-tight">{label}</p>
        <p className="text-xs text-slate-300 mt-0.5 break-all">{value}</p>
      </div>
    </div>
  );
}

const NOTE_STYLES = {
  discord: {
    border: 'border-l-indigo-500/60',
    icon: MessageSquare,
    iconCls: 'text-indigo-400',
    authorCls: 'text-indigo-300',
    badge: 'bg-indigo-600/15 text-indigo-400',
    label: 'Discord'
  },
  reply: {
    border: 'border-l-emerald-500/60',
    icon: Reply,
    iconCls: 'text-emerald-400',
    authorCls: 'text-emerald-300',
    badge: 'bg-emerald-600/15 text-emerald-400',
    label: 'Réponse'
  },
  web: {
    border: 'border-l-slate-700',
    icon: Lock,
    iconCls: 'text-slate-500',
    authorCls: 'text-slate-300',
    badge: 'bg-slate-700/60 text-slate-500',
    label: 'Note'
  },
  user: {
    border: 'border-l-violet-500/60',
    icon: UserCircle,
    iconCls: 'text-violet-400',
    authorCls: 'text-violet-300',
    badge: 'bg-violet-600/15 text-violet-400',
    label: 'Utilisateur'
  }
};

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
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [movingTicket, setMovingTicket] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [composeMode, setComposeMode] = useState('note');

  // Subject editing
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectInput, setSubjectInput] = useState('');
  const [savingSubject, setSavingSubject] = useState(false);

  // Templates
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const templatesRef = useRef(null);

  const ticketId = parseInt(id);

  const loadTicket = useCallback(() => {
    api.get(`/tickets/${id}`)
      .then(r => setTicket(r.data))
      .catch(() => toast.error('Ticket introuvable'))
      .finally(() => setLoading(false));
  }, [id]);

  const loadNotes = useCallback(() => {
    api.get(`/tickets/${id}/notes`)
      .then(r => setNotes(r.data))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    loadTicket();
    loadNotes();
    api.get('/discord/categories').then(r => setCategories(r.data)).catch(() => {});
    api.get('/templates').then(r => setTemplates(r.data)).catch(() => {});

    // Mark ticket as seen
    localStorage.setItem(`ticket_seen_${id}`, Date.now().toString());
  }, [loadTicket, loadNotes, id]);

  // SSE real-time updates
  useSSE({
    note: (data) => {
      if (data.ticketId !== ticketId) return;
      setNotes(prev => {
        if (prev.some(n => n.id === data.note.id)) return prev;
        // Mark ticket as still being seen (no unread dot)
        localStorage.setItem(`ticket_seen_${id}`, Date.now().toString());
        return [...prev, data.note];
      });
    },
    ticket: (data) => {
      if (data.id !== ticketId) return;
      setTicket(prev => prev ? { ...prev, ...data } : prev);
      if (data.subject !== undefined) setSubjectInput(data.subject || '');
    }
  });

  // Close templates dropdown on outside click
  useEffect(() => {
    if (!showTemplates) return;
    function handleClick(e) {
      if (templatesRef.current && !templatesRef.current.contains(e.target)) {
        setShowTemplates(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTemplates]);

  const changePriority = async (priority) => {
    setSaving(true);
    try {
      await api.patch(`/tickets/${id}/priority`, { priority });
      setTicket(t => ({ ...t, priority }));
      toast.success('Priorité mise à jour');
    } catch {
      toast.error('Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status) => {
    setActionLoading(true);
    try {
      await api.patch(`/tickets/${id}/status`, { status });
      setTicket(t => ({ ...t, status }));
      toast.success(status === 'closed' ? 'Ticket fermé' : 'Ticket réouvert');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setActionLoading(false);
    }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      await api.post(`/tickets/${id}/notes`, { content: newNote.trim() });
      setNewNote('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setSavingNote(false);
    }
  };

  const sendReply = async () => {
    if (!replyText.trim()) return;
    setSendingReply(true);
    try {
      await api.post(`/tickets/${id}/reply`, { content: replyText.trim(), anonymous });
      setReplyText('');
      toast.success('Réponse envoyée');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setSendingReply(false);
    }
  };

  const toggleClaim = async () => {
    const isClaimed = ticket.claimed_by === user?.id;
    const isFondateur = user?.role === 'fondateur';
    const action = (isClaimed || (isFondateur && ticket.claimed_by)) ? 'unclaim' : 'claim';
    setClaimLoading(true);
    try {
      const { data } = await api.patch(`/tickets/${id}/claim`, { action });
      setTicket(t => ({ ...t, claimed_by: data.claimed_by }));
      toast.success(action === 'claim' ? 'Ticket réclamé' : 'Ticket libéré');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setClaimLoading(false);
    }
  };

  const addParticipant = async () => {
    if (!newParticipantId.trim()) return;
    setAddingParticipant(true);
    try {
      const { data } = await api.post(`/tickets/${id}/participants`, { discord_id: newParticipantId.trim() });
      setTicket(t => ({ ...t, participants: [...(t.participants || []), data] }));
      setNewParticipantId('');
      toast.success(`${data.tag} ajouté`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setAddingParticipant(false);
    }
  };

  const removeParticipant = async (userId) => {
    try {
      await api.delete(`/tickets/${id}/participants/${userId}`);
      setTicket(t => ({ ...t, participants: t.participants.filter(p => p.id !== userId) }));
      toast.success('Participant retiré');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  };

  const moveTicket = async () => {
    if (!selectedCategory) return;
    setMovingTicket(true);
    try {
      const { data } = await api.patch(`/tickets/${id}/move`, { category_id: selectedCategory });
      toast.success(`Déplacé dans ${data.category_name}`);
      setSelectedCategory('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setMovingTicket(false);
    }
  };

  const renameTicket = async () => {
    if (!renameValue.trim()) return;
    setRenaming(true);
    try {
      const { data } = await api.patch(`/tickets/${id}/rename`, { name: renameValue.trim() });
      toast.success(`Renommé en ${data.name}`);
      setRenameValue('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setRenaming(false);
    }
  };

  const saveSubject = async () => {
    setSavingSubject(true);
    try {
      const { data } = await api.patch(`/tickets/${id}/subject`, { subject: subjectInput.trim() || null });
      setTicket(t => ({ ...t, subject: data.subject }));
      setEditingSubject(false);
      toast.success('Sujet mis à jour');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setSavingSubject(false);
    }
  };

  const startEditSubject = () => {
    setSubjectInput(ticket.subject || '');
    setEditingSubject(true);
  };

  const deleteNote = async (noteId) => {
    try {
      await api.delete(`/tickets/${id}/notes/${noteId}`);
      setNotes(n => n.filter(x => x.id !== noteId));
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  };

  const saveTemplate = async () => {
    if (!composeText.trim() || !newTemplateName.trim()) return;
    setSavingTemplate(true);
    try {
      const { data } = await api.post('/templates', { name: newTemplateName.trim(), content: composeText.trim() });
      setTemplates(t => [...t, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTemplateName('');
      toast.success('Template sauvegardé');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setSavingTemplate(false);
    }
  };

  const deleteTemplate = async (tplId, e) => {
    e.stopPropagation();
    try {
      await api.delete(`/templates/${tplId}`);
      setTemplates(t => t.filter(x => x.id !== tplId));
    } catch {
      toast.error('Erreur');
    }
  };

  if (loading) return <div className="flex-1 p-6 text-slate-500 text-sm">Chargement...</div>;
  if (!ticket) return <div className="flex-1 p-6 text-red-400 text-sm">Ticket introuvable.</div>;

  const myClaim = ticket.claimed_by === user?.id;
  const anyClaim = !!ticket.claimed_by;
  const canClaim = !anyClaim || myClaim || user?.role === 'fondateur';
  const claimLabel = myClaim
    ? 'Libérer le ticket'
    : anyClaim && user?.role === 'fondateur'
    ? 'Libérer (override)'
    : 'Prendre en charge';

  const composeText = composeMode === 'note' ? newNote : replyText;
  const setComposeText = composeMode === 'note' ? setNewNote : setReplyText;
  const composeSending = composeMode === 'note' ? savingNote : sendingReply;
  const handleSend = composeMode === 'note' ? addNote : sendReply;

  return (
    <div className="flex flex-1 min-h-screen overflow-hidden">

      {/* ── Left column: timeline + compose ── */}
      <div className="flex flex-col flex-1 min-w-0 min-h-screen overflow-y-auto">

        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800/60 px-5 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/tickets')}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-100 hover:bg-slate-800 transition-colors flex-shrink-0"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-slate-700">·</span>
          <span className="text-sm font-semibold text-slate-200">Ticket #{ticket.id}</span>
          <span className="text-slate-700">·</span>
          <Badge label={ticket.status} variant={ticket.status} />
          <Badge label={PRIORITY_LABELS[ticket.priority] || ticket.priority} variant={ticket.priority} />
          {ticket.owner_tag && (
            <>
              <span className="text-slate-700">·</span>
              <span className="text-xs text-slate-500">{ticket.owner_tag}</span>
            </>
          )}
          {ticket.created_at && (
            <>
              <span className="text-slate-700">·</span>
              <span className="text-xs text-slate-600">{fmtDate(ticket.created_at, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            </>
          )}
        </div>

        {/* Timeline */}
        <div className="flex-1 px-5 py-5 space-y-3">
          {notes.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center">
                <MessageSquare size={20} className="text-slate-600" />
              </div>
              <p className="text-sm text-slate-600 font-medium">Aucune note pour l'instant</p>
              <p className="text-xs text-slate-700">Les messages Discord, réponses et notes internes apparaîtront ici.</p>
            </div>
          )}

          {notes.map(note => {
            const style = NOTE_STYLES[note.source] || NOTE_STYLES.web;
            const NoteIcon = style.icon;
            const canDelete = user?.role === 'fondateur' || note.author_id === user?.id;
            return (
              <div
                key={note.id}
                className={`border-l-2 pl-4 py-2 group ${style.border}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <NoteIcon size={12} className={style.iconCls} />
                  <span className={`text-xs font-medium ${style.authorCls}`}>{note.author_tag}</span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${style.badge}`}>
                    {style.label}
                  </span>
                  <span className="text-[10px] text-slate-700 ml-auto">{fmtDate(note.created_at)}</span>
                  {canDelete && (
                    <button
                      onClick={() => deleteNote(note.id)}
                      className="text-slate-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 ml-1"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <p className="text-sm text-slate-400 whitespace-pre-wrap leading-relaxed">{note.content}</p>
              </div>
            );
          })}
        </div>

        {/* Compose box */}
        {ticket.status === 'open' && (
          <div className="border-t border-slate-800/60 bg-slate-900/50 px-5 py-4">
            {/* Mode toggle */}
            <div className="flex gap-1 mb-3 bg-slate-800/60 rounded-lg p-0.5 w-fit">
              <button
                onClick={() => setComposeMode('note')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  composeMode === 'note'
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Lock size={11} />
                Note interne
              </button>
              <button
                onClick={() => setComposeMode('reply')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  composeMode === 'reply'
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Reply size={11} />
                Répondre
              </button>
            </div>

            {/* Textarea */}
            <textarea
              value={composeText}
              onChange={e => setComposeText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSend(); }}
              placeholder={
                composeMode === 'note'
                  ? 'Ajouter une note interne... (Ctrl+Entrée pour envoyer)'
                  : 'Votre réponse à l\'utilisateur... (Ctrl+Entrée pour envoyer)'
              }
              rows={3}
              maxLength={2000}
              className={`w-full bg-slate-800/50 border text-slate-300 placeholder-slate-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none resize-none transition-colors ${
                composeMode === 'note'
                  ? 'border-slate-700/60 focus:border-indigo-500/60'
                  : 'border-slate-700/60 focus:border-emerald-500/60'
              }`}
            />

            {/* Footer */}
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-700">{composeText.length}/2000</span>

                {/* Templates dropdown */}
                <div className="relative" ref={templatesRef}>
                  <button
                    onClick={() => setShowTemplates(t => !t)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border bg-slate-800 text-slate-500 border-slate-700/60 hover:text-slate-300 transition-colors"
                  >
                    <Layers size={11} />
                    Templates
                  </button>
                  {showTemplates && (
                    <div className="absolute bottom-full mb-1.5 left-0 z-20 w-72 bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden">
                      <div className="max-h-48 overflow-y-auto">
                        {templates.length === 0 ? (
                          <p className="text-xs text-slate-600 p-3 text-center">Aucun template</p>
                        ) : templates.map(tpl => (
                          <div
                            key={tpl.id}
                            className="group flex items-start gap-2 px-3 py-2 hover:bg-slate-800 border-b border-slate-800/60 last:border-0 transition-colors cursor-pointer"
                            onClick={() => { setComposeText(tpl.content); setShowTemplates(false); }}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-200 truncate">{tpl.name}</p>
                              <p className="text-[10px] text-slate-500 truncate mt-0.5">{tpl.content}</p>
                            </div>
                            {(user?.role === 'fondateur' || tpl.created_by_id === user?.id) && (
                              <button
                                onClick={(e) => deleteTemplate(tpl.id, e)}
                                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {user?.role === 'fondateur' && (
                        <div className="border-t border-slate-700/60 px-3 py-2 space-y-1.5">
                          <input
                            type="text"
                            placeholder="Nom du template..."
                            value={newTemplateName}
                            onChange={e => setNewTemplateName(e.target.value)}
                            className="w-full bg-slate-800/60 border border-slate-700/60 text-slate-300 placeholder-slate-600 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-indigo-500/60"
                          />
                          <button
                            onClick={saveTemplate}
                            disabled={!composeText.trim() || !newTemplateName.trim() || savingTemplate}
                            className="w-full py-1.5 text-xs rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-600/25 hover:bg-indigo-600/30 disabled:opacity-40 transition-colors font-medium"
                          >
                            {savingTemplate ? 'Sauvegarde...' : 'Sauvegarder ce texte'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {composeMode === 'reply' && (
                  <button
                    onClick={() => setAnonymous(a => !a)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                      anonymous
                        ? 'bg-indigo-600/15 text-indigo-400 border-indigo-600/25'
                        : 'bg-slate-800 text-slate-500 border-slate-700/60 hover:text-slate-300'
                    }`}
                  >
                    {anonymous ? <EyeOff size={11} /> : <Eye size={11} />}
                    {anonymous ? 'Anonyme' : 'Identifié'}
                  </button>
                )}
              </div>
              <button
                onClick={handleSend}
                disabled={!composeText.trim() || composeSending}
                className={`flex items-center gap-1.5 py-1.5 px-3 text-xs rounded-lg text-white font-medium transition-colors disabled:opacity-50 ${
                  composeMode === 'note'
                    ? 'bg-indigo-600 hover:bg-indigo-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                <Send size={11} />
                {composeSending ? 'Envoi...' : composeMode === 'note' ? 'Ajouter' : 'Envoyer'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right column: sidebar ── */}
      <div className="w-72 flex-shrink-0 sticky top-0 h-screen overflow-y-auto border-l border-slate-800/60 p-5 space-y-5">

        {/* INFORMATIONS */}
        <div>
          <SectionTitle>Informations</SectionTitle>
          <div className="space-y-0.5">
            <InfoRow icon={User} label="Propriétaire" value={ticket.owner_tag} />
            <InfoRow icon={Clock} label="Créé le" value={fmtDate(ticket.created_at, { dateStyle: 'medium', timeStyle: 'short' })} />
            {ticket.closed_at && (
              <InfoRow icon={CheckCircle2} label="Fermé le" value={fmtDate(ticket.closed_at, { dateStyle: 'medium', timeStyle: 'short' })} />
            )}
            {ticket.closed_by_tag && (
              <InfoRow icon={User} label="Fermé par" value={ticket.closed_by_tag} />
            )}
            <InfoRow icon={User} label="Pris en charge par" value={ticket.claimed_by || null} />

            {/* Subject with inline edit */}
            <div className="flex items-start gap-2 py-1">
              <FileText size={12} className="text-slate-600 mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-slate-600 leading-tight">Sujet</p>
                {editingSubject ? (
                  <div className="flex items-center gap-1 mt-0.5">
                    <input
                      type="text"
                      value={subjectInput}
                      onChange={e => setSubjectInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveSubject();
                        if (e.key === 'Escape') setEditingSubject(false);
                      }}
                      maxLength={100}
                      placeholder="Sujet du ticket..."
                      autoFocus
                      className="flex-1 min-w-0 bg-slate-800/60 border border-slate-700/60 text-slate-300 placeholder-slate-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500/60"
                    />
                    <button
                      onClick={saveSubject}
                      disabled={savingSubject}
                      className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={() => setEditingSubject(false)}
                      className="text-slate-600 hover:text-slate-300"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 mt-0.5 group/subject">
                    <p className="text-xs text-slate-300 break-all">
                      {ticket.subject || <span className="italic text-slate-700">—</span>}
                    </p>
                    <button
                      onClick={startEditSubject}
                      className="opacity-0 group-hover/subject:opacity-100 text-slate-600 hover:text-slate-300 transition-colors flex-shrink-0"
                    >
                      <Pencil size={10} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ACTIONS */}
        {(ticket.status === 'open' || (ticket.status === 'closed' && user?.role === 'fondateur')) && (
          <div>
            <SectionTitle>Actions</SectionTitle>
            <div className="space-y-2">
              {ticket.status === 'open' && (
                <>
                  <button
                    onClick={toggleClaim}
                    disabled={claimLoading || !canClaim}
                    className={`w-full py-1.5 px-3 text-xs rounded-lg font-medium transition-colors disabled:opacity-50 border ${
                      myClaim || (anyClaim && user?.role === 'fondateur')
                        ? 'bg-amber-600/15 text-amber-400 border-amber-600/25 hover:bg-amber-600/25'
                        : 'bg-emerald-600/15 text-emerald-400 border-emerald-600/25 hover:bg-emerald-600/25'
                    }`}
                  >
                    {claimLoading ? 'En cours...' : claimLabel}
                  </button>
                  {user?.role === 'fondateur' && (
                    <button
                      onClick={() => changeStatus('closed')}
                      disabled={actionLoading}
                      className="w-full py-1.5 px-3 text-xs rounded-lg font-medium transition-colors disabled:opacity-50 border bg-red-600/15 text-red-400 border-red-600/25 hover:bg-red-600/25"
                    >
                      {actionLoading ? 'En cours...' : 'Fermer le ticket'}
                    </button>
                  )}
                </>
              )}
              {ticket.status === 'closed' && user?.role === 'fondateur' && (
                <button
                  onClick={() => changeStatus('open')}
                  disabled={actionLoading}
                  className="w-full py-1.5 px-3 text-xs rounded-lg font-medium transition-colors disabled:opacity-50 border bg-emerald-600/15 text-emerald-400 border-emerald-600/25 hover:bg-emerald-600/25"
                >
                  {actionLoading ? 'En cours...' : 'Réouvrir le ticket'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* PRIORITÉ */}
        <div>
          <SectionTitle>Priorité</SectionTitle>
          <div className="flex gap-1.5">
            {['low', 'normal', 'urgent'].map(p => (
              <button
                key={p}
                onClick={() => changePriority(p)}
                disabled={saving || ticket.priority === p}
                className={`flex-1 py-1.5 px-2 text-xs rounded-lg font-medium transition-colors disabled:cursor-not-allowed border ${
                  ticket.priority === p
                    ? PRIORITY_ACTIVE[p]
                    : 'bg-slate-800/60 text-slate-500 border-slate-700/60 hover:bg-slate-800 hover:text-slate-300'
                }`}
              >
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* PARTICIPANTS */}
        <div>
          <SectionTitle>Participants ({ticket.participants?.length || 0})</SectionTitle>
          {ticket.participants?.length > 0 ? (
            <div className="space-y-1 mb-2">
              {ticket.participants.map(p => (
                <div key={p.id} className="group flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-800/40 border border-slate-800/60 hover:border-slate-700/60 transition-colors">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-300 font-medium truncate">{p.tag}</p>
                    <p className="text-[10px] text-slate-600 font-mono">{p.id}</p>
                  </div>
                  {ticket.status === 'open' && (
                    <button
                      onClick={() => removeParticipant(p.id)}
                      className="text-slate-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-700 italic mb-2">Aucun participant.</p>
          )}
          {ticket.status === 'open' && (
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newParticipantId}
                onChange={e => setNewParticipantId(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addParticipant(); }}
                placeholder="Discord ID..."
                className="flex-1 min-w-0 bg-slate-800/50 border border-slate-700/60 text-slate-300 placeholder-slate-600 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-indigo-500/60 font-mono transition-colors"
              />
              <button
                onClick={addParticipant}
                disabled={!newParticipantId.trim() || addingParticipant}
                className="p-1.5 rounded-lg bg-slate-800 border border-slate-700/60 text-slate-400 hover:text-slate-100 hover:bg-slate-700 transition-colors disabled:opacity-50 flex-shrink-0"
                title="Ajouter"
              >
                <UserPlus size={14} />
              </button>
            </div>
          )}
        </div>

        {/* RENOMMER */}
        {ticket.status === 'open' && (
          <div>
            <SectionTitle>Renommer</SectionTitle>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') renameTicket(); }}
                placeholder="Nouveau nom..."
                maxLength={40}
                className="flex-1 min-w-0 bg-slate-800/50 border border-slate-700/60 text-slate-300 placeholder-slate-600 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-indigo-500/60 transition-colors"
              />
              <button
                onClick={renameTicket}
                disabled={!renameValue.trim() || renaming}
                className="p-1.5 rounded-lg bg-slate-800 border border-slate-700/60 text-slate-400 hover:text-slate-100 hover:bg-slate-700 transition-colors disabled:opacity-50 flex-shrink-0"
                title="Renommer"
              >
                <Pencil size={14} />
              </button>
            </div>
          </div>
        )}

        {/* DÉPLACER */}
        {ticket.status === 'open' && categories.length > 0 && (
          <div>
            <SectionTitle>Déplacer</SectionTitle>
            <div className="flex gap-1.5">
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="flex-1 min-w-0 bg-slate-800/50 border border-slate-700/60 text-slate-400 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-indigo-500/60 transition-colors"
              >
                <option value="">Catégorie...</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={moveTicket}
                disabled={!selectedCategory || movingTicket}
                className="p-1.5 rounded-lg bg-slate-800 border border-slate-700/60 text-slate-400 hover:text-slate-100 hover:bg-slate-700 transition-colors disabled:opacity-50 flex-shrink-0"
                title="Déplacer"
              >
                <FolderOpen size={14} />
              </button>
            </div>
          </div>
        )}

        {/* SATISFACTION */}
        {ticket.rating && (
          <div>
            <SectionTitle>Satisfaction</SectionTitle>
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5">
                {[1,2,3,4,5].map(i => (
                  <Star
                    key={i}
                    size={16}
                    fill={i <= ticket.rating.rating ? '#f59e0b' : 'none'}
                    className={i <= ticket.rating.rating ? 'text-amber-400' : 'text-slate-700'}
                  />
                ))}
              </div>
              <span className="text-xs text-slate-400 font-medium">{ticket.rating.rating}/5</span>
            </div>
            <p className="text-[10px] text-slate-700 mt-1">{fmtDate(ticket.rating.rated_at, { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </div>
        )}

        {/* TRANSCRIPT */}
        {ticket.transcript && (
          <div>
            <SectionTitle>Transcript</SectionTitle>
            <p className="text-[10px] text-slate-600 mb-2">
              {ticket.transcript.message_count} messages · {ticket.transcript.created_by_tag}
            </p>
            <div className="flex flex-col gap-1.5">
              <a
                href={`/api/transcripts/${ticket.transcript.id}/html`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 py-1.5 px-3 text-xs rounded-lg bg-indigo-600/15 text-indigo-400 border border-indigo-600/25 hover:bg-indigo-600/25 transition-colors font-medium"
              >
                <FileText size={12} /> Voir HTML
              </a>
              <a
                href={`/api/transcripts/${ticket.transcript.id}/txt`}
                className="flex items-center gap-1.5 py-1.5 px-3 text-xs rounded-lg bg-slate-800/60 text-slate-400 border border-slate-700/60 hover:bg-slate-800 transition-colors font-medium"
              >
                Télécharger .txt
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
