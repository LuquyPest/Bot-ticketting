import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Star, FileText, User, Clock, Tag, X, Send, MessageSquare, Globe, Reply, UserPlus, FolderOpen, Pencil } from 'lucide-react';
import api from '../api';
import Badge from '../components/Badge';
import toast from 'react-hot-toast';
import { fmtDate } from '../utils/format';
import { useAuth } from '../App';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

function InfoRow({ label, value, icon: Icon }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-md bg-slate-800 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={13} className="text-slate-500" />
      </div>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm text-slate-200 mt-0.5">{value || '—'}</p>
      </div>
    </div>
  );
}

const PRIORITY_LABELS = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };

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
    api.get('/discord/categories')
      .then(r => setCategories(r.data))
      .catch(() => {});
  }, [loadTicket, loadNotes]);

  useAutoRefresh(loadNotes, 15000);

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
      const { data } = await api.post(`/tickets/${id}/notes`, { content: newNote.trim() });
      setNotes(n => [...n, data]);
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
      const { data } = await api.post(`/tickets/${id}/reply`, { content: replyText.trim(), anonymous });
      setNotes(n => [...n, data]);
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

  const deleteNote = async (noteId) => {
    try {
      await api.delete(`/tickets/${id}/notes/${noteId}`);
      setNotes(n => n.filter(x => x.id !== noteId));
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  };

  if (loading) return <div className="p-6 text-slate-500">Chargement...</div>;
  if (!ticket) return <div className="p-6 text-red-400">Ticket introuvable.</div>;

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/tickets')} className="p-2 rounded-lg text-slate-500 hover:text-slate-100 hover:bg-slate-800 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-100">Ticket #{ticket.id}</h1>
            <Badge label={ticket.status} variant={ticket.status} />
            <Badge label={PRIORITY_LABELS[ticket.priority] || ticket.priority} variant={ticket.priority} />
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{ticket.subject || 'Sans sujet'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Info */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-300">Informations</h2>
          <InfoRow label="Propriétaire" value={ticket.owner_tag} icon={User} />
          <InfoRow label="Sujet" value={ticket.subject} icon={Tag} />
          <InfoRow label="Créé le" value={fmtDate(ticket.created_at, { dateStyle: "medium", timeStyle: "short" })} icon={Clock} />
          <InfoRow label="Fermé le" value={fmtDate(ticket.closed_at, { dateStyle: "medium", timeStyle: "short" })} icon={Clock} />
          <InfoRow label="Fermé par" value={ticket.closed_by_tag} icon={User} />
          <InfoRow label="Claim par" value={ticket.claimed_by || 'Non réclamé'} icon={User} />
        </div>

        {/* Actions */}
        <div className="space-y-4">
          {ticket.status === 'open' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Actions</h2>
              <div className="space-y-2">
                {/* Claim / Unclaim */}
                {(() => {
                  const myClaim = ticket.claimed_by === user?.id;
                  const anyClaim = !!ticket.claimed_by;
                  const canClaim = !anyClaim || myClaim || user?.role === 'fondateur';
                  const label = myClaim ? 'Libérer le ticket' : anyClaim && user?.role === 'fondateur' ? 'Libérer (override)' : 'Prendre en charge';
                  return (
                    <button
                      onClick={toggleClaim}
                      disabled={claimLoading || !canClaim}
                      className={`w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 border ${
                        myClaim || (anyClaim && user?.role === 'fondateur')
                          ? 'bg-amber-600/20 text-amber-400 border-amber-600/30 hover:bg-amber-600/30'
                          : 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/30'
                      }`}
                    >
                      {claimLoading ? 'En cours...' : label}
                    </button>
                  );
                })()}
                {/* Close (fondateur only) */}
                {user?.role === 'fondateur' && (
                  <button
                    onClick={() => changeStatus('closed')}
                    disabled={actionLoading}
                    className="w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 border bg-red-600/20 text-red-400 border-red-600/30 hover:bg-red-600/30"
                  >
                    {actionLoading ? 'En cours...' : 'Fermer le ticket'}
                  </button>
                )}
              </div>
            </div>
          )}
          {ticket.status === 'closed' && user?.role === 'fondateur' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Actions</h2>
              <button
                onClick={() => changeStatus('open')}
                disabled={actionLoading}
                className="w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 border bg-emerald-600/20 text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/30"
              >
                {actionLoading ? 'En cours...' : 'Réouvrir le ticket'}
              </button>
            </div>
          )}

          {/* Priority */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Changer la priorité</h2>
            <div className="flex gap-2">
              {['low', 'normal', 'urgent'].map(p => (
                <button
                  key={p}
                  onClick={() => changePriority(p)}
                  disabled={saving || ticket.priority === p}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors disabled:cursor-not-allowed border ${
                    ticket.priority === p
                      ? p === 'urgent' ? 'bg-red-600/20 text-red-400 border-red-600/30'
                      : p === 'normal' ? 'bg-amber-600/20 text-amber-400 border-amber-600/30'
                      : 'bg-sky-600/20 text-sky-400 border-sky-600/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Rename (ticket open) */}
          {ticket.status === 'open' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-1.5">
                <Pencil size={13} className="text-slate-500" /> Renommer le salon
              </h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') renameTicket(); }}
                  placeholder="Nouveau nom..."
                  maxLength={40}
                  className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-slate-500"
                />
                <button
                  onClick={renameTicket}
                  disabled={!renameValue.trim() || renaming}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 text-xs font-medium hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  {renaming ? '...' : 'Renommer'}
                </button>
              </div>
            </div>
          )}

          {/* Move (ticket open, categories available) */}
          {ticket.status === 'open' && categories.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-1.5">
                <FolderOpen size={13} className="text-slate-500" /> Déplacer le ticket
              </h2>
              <div className="flex gap-2">
                <select
                  value={selectedCategory}
                  onChange={e => setSelectedCategory(e.target.value)}
                  className="flex-1 bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-slate-500"
                >
                  <option value="">Choisir une catégorie...</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  onClick={moveTicket}
                  disabled={!selectedCategory || movingTicket}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 text-xs font-medium hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  {movingTicket ? '...' : 'Déplacer'}
                </button>
              </div>
            </div>
          )}

          {/* Rating */}
          {ticket.rating && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-2">Note de satisfaction</h2>
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map(i => (
                    <Star key={i} size={18} fill={i <= ticket.rating.rating ? '#f59e0b' : 'none'} className={i <= ticket.rating.rating ? 'text-amber-400' : 'text-slate-700'} />
                  ))}
                </div>
                <span className="text-sm text-slate-400">{ticket.rating.rating}/5</span>
              </div>
              <p className="text-xs text-slate-600 mt-1">{fmtDate(ticket.rating.rated_at, { dateStyle: "medium", timeStyle: "short" })}</p>
            </div>
          )}

          {/* Transcript */}
          {ticket.transcript && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Transcript</h2>
              <div className="text-xs text-slate-500 mb-3">
                <p>{ticket.transcript.message_count} messages · par {ticket.transcript.created_by_tag}</p>
                <p>{fmtDate(ticket.transcript.created_at, { dateStyle: "medium", timeStyle: "short" })}</p>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/api/transcripts/${ticket.transcript.id}/html`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-600/30 text-xs font-medium hover:bg-indigo-600/30 transition-colors"
                >
                  <FileText size={13} /> Voir HTML
                </a>
                <a
                  href={`/api/transcripts/${ticket.transcript.id}/txt`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 text-xs font-medium hover:bg-slate-700 transition-colors"
                >
                  Télécharger .txt
                </a>
              </div>
            </div>
          )}

          {/* Participants */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-1.5">
              <UserPlus size={13} className="text-slate-500" /> Participants ({ticket.participants?.length || 0})
            </h2>
            {ticket.participants?.length > 0 ? (
              <div className="space-y-1.5 mb-3">
                {ticket.participants.map(p => (
                  <div key={p.id} className="flex items-center justify-between px-2 py-1 rounded-md bg-slate-800 border border-slate-700">
                    <div>
                      <span className="text-xs text-slate-300 font-medium">{p.tag}</span>
                      <span className="text-xs text-slate-600 ml-1.5 font-mono">{p.id}</span>
                    </div>
                    {ticket.status === 'open' && (
                      <button
                        onClick={() => removeParticipant(p.id)}
                        className="text-slate-600 hover:text-red-400 transition-colors ml-2"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600 italic mb-3">Aucun participant.</p>
            )}
            {ticket.status === 'open' && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newParticipantId}
                  onChange={e => setNewParticipantId(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addParticipant(); }}
                  placeholder="Discord ID (ex: 123456789012345678)"
                  className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-600 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-slate-500 font-mono"
                />
                <button
                  onClick={addParticipant}
                  disabled={!newParticipantId.trim() || addingParticipant}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 text-xs font-medium hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  {addingParticipant ? '...' : 'Ajouter'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notes internes */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-300">Notes internes</h2>

        {notes.length === 0 && (
          <p className="text-xs text-slate-600 italic">Aucune note pour l'instant.</p>
        )}

        <div className="space-y-3">
          {notes.map(note => (
            <div
              key={note.id}
              className={`border rounded-lg p-3 ${
                note.source === 'discord'
                  ? 'bg-indigo-600/5 border-indigo-600/20'
                  : note.source === 'reply'
                  ? 'bg-emerald-600/5 border-emerald-600/20'
                  : 'bg-slate-800/50 border-slate-700/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  {note.source === 'discord'
                    ? <MessageSquare size={11} className="text-indigo-400" />
                    : note.source === 'reply'
                    ? <Reply size={11} className="text-emerald-400" />
                    : <Globe size={11} className="text-slate-500" />
                  }
                  <span className={`text-xs font-medium ${
                    note.source === 'discord' ? 'text-indigo-300'
                    : note.source === 'reply' ? 'text-emerald-300'
                    : 'text-slate-300'
                  }`}>
                    {note.author_tag}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    note.source === 'discord'
                      ? 'bg-indigo-600/20 text-indigo-400'
                      : note.source === 'reply'
                      ? 'bg-emerald-600/20 text-emerald-400'
                      : 'bg-slate-700 text-slate-500'
                  }`}>
                    {note.source === 'discord' ? 'Discord' : note.source === 'reply' ? 'Réponse' : 'Dashboard'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600">{fmtDate(note.created_at)}</span>
                  {(user?.role === 'fondateur' || note.author_id === user?.id) && (
                    <button
                      onClick={() => deleteNote(note.id)}
                      className="text-slate-600 hover:text-red-400 transition-colors"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-slate-400 whitespace-pre-wrap">{note.content}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2 pt-1">
          <textarea
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) addNote(); }}
            placeholder="Ajouter une note interne... (Ctrl+Entrée pour envoyer)"
            rows={2}
            maxLength={2000}
            className="w-full bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600">{newNote.length}/2000</span>
            <button
              onClick={addNote}
              disabled={!newNote.trim() || savingNote}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              <Send size={12} /> Ajouter
            </button>
          </div>
        </div>
      </div>

      {/* Répondre à l'utilisateur */}
      {ticket.status === 'open' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">Répondre à l'utilisateur</h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-slate-500">Anonyme</span>
              <div
                onClick={() => setAnonymous(a => !a)}
                className={`w-8 h-4 rounded-full transition-colors relative cursor-pointer ${anonymous ? 'bg-indigo-600' : 'bg-slate-700'}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${anonymous ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </label>
          </div>
          <p className="text-xs text-slate-500">
            {anonymous
              ? 'Le message sera envoyé comme "--- Support : …" (sans ton nom).'
              : 'Le message sera envoyé en DM à l\'utilisateur et affiché dans le salon Discord.'}
          </p>
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) sendReply(); }}
            placeholder="Votre réponse... (Ctrl+Entrée pour envoyer)"
            rows={3}
            maxLength={2000}
            className="w-full bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600">{replyText.length}/2000</span>
            <button
              onClick={sendReply}
              disabled={!replyText.trim() || sendingReply}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50"
            >
              <Send size={12} /> Envoyer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
