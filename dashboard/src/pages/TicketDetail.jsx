import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Star, FileText, User, Clock, Tag, X, Send } from 'lucide-react';
import api from '../api';
import Badge from '../components/Badge';
import toast from 'react-hot-toast';
import { fmtDate } from '../utils/format';
import { useAuth } from '../App';

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
  }, [loadTicket, loadNotes]);

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
          {/* Status (fondateur only) */}
          {user?.role === 'fondateur' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Actions</h2>
              <button
                onClick={() => changeStatus(ticket.status === 'open' ? 'closed' : 'open')}
                disabled={actionLoading}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 border ${
                  ticket.status === 'open'
                    ? 'bg-red-600/20 text-red-400 border-red-600/30 hover:bg-red-600/30'
                    : 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/30'
                }`}
              >
                {actionLoading ? 'En cours...' : ticket.status === 'open' ? 'Fermer le ticket' : 'Réouvrir le ticket'}
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
          {ticket.participants?.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Participants ({ticket.participants.length})</h2>
              <div className="flex flex-wrap gap-2">
                {ticket.participants.map(uid => (
                  <span key={uid} className="px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-400 font-mono">{uid}</span>
                ))}
              </div>
            </div>
          )}
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
            <div key={note.id} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-slate-300">{note.author_tag}</span>
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
    </div>
  );
}
