import React, { useEffect, useState, useCallback } from 'react';
import { CalendarClock, Trash2, RefreshCw, Plus, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { fmtDate } from '../utils/format';
import { confirmToast } from '../utils/confirmToast';

function AddModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ ticket_id: '', content: '', send_at: '' });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.ticket_id || !form.content || !form.send_at) {
      return toast.error('Tous les champs sont requis');
    }
    setLoading(true);
    try {
      await api.post('/messages', form);
      toast.success('Message programmé');
      onAdded();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  // Min datetime = now + 2 minutes
  const minDt = new Date(Date.now() + 2 * 60000).toISOString().slice(0, 16);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface-card border border-white/[0.08] rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-ink-1">Programmer un message</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink-2"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-ink-3 mb-1 block">ID du ticket *</label>
            <input
              type="number" min="1"
              value={form.ticket_id}
              onChange={e => setForm(f => ({ ...f, ticket_id: e.target.value }))}
              placeholder="123"
              className="w-full bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs text-ink-3 mb-1 block">Message *</label>
            <textarea
              rows={4}
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="Contenu du message..."
              className="w-full bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
            />
          </div>
          <div>
            <label className="text-xs text-ink-3 mb-1 block">Envoyer à *</label>
            <input
              type="datetime-local"
              min={minDt}
              value={form.send_at}
              onChange={e => setForm(f => ({ ...f, send_at: e.target.value }))}
              className="w-full bg-surface border border-white/[0.08] text-ink-1 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg bg-surface text-ink-2 text-sm hover:bg-surface-hover transition-colors">Annuler</button>
            <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50">
              {loading ? 'Envoi...' : 'Programmer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Messages() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/messages').then(r => setMessages(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const cancel = async (id) => {
    if (!await confirmToast('Annuler ce message programmé ?')) return;
    try {
      await api.delete(`/messages/${id}`);
      setMessages(m => m.filter(x => x.id !== id));
      toast.success('Message annulé');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  };

  const pending = messages.filter(m => !m.sent);
  const sent    = messages.filter(m => m.sent);

  return (
    <div className="p-6 space-y-5">
      {showModal && <AddModal onClose={() => setShowModal(false)} onAdded={load} />}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <CalendarClock size={20} className="text-primary-light" />
          <div>
            <h1 className="text-xl font-bold text-ink-1 tracking-tight">Messages programmés</h1>
            <p className="text-sm text-ink-3">{pending.length} en attente</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
            <Plus size={14} /> Programmer
          </button>
        </div>
      </div>

      {/* Pending */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">En attente</h2>
        {loading ? (
          <div className="text-center py-8 text-ink-4 text-sm">Chargement...</div>
        ) : pending.length === 0 ? (
          <div className="bg-surface-card border border-white/[0.06] rounded-xl p-8 text-center text-ink-4 text-sm">
            Aucun message programmé
          </div>
        ) : (
          <div className="bg-surface-card border border-white/[0.06] rounded-xl overflow-hidden">
            {pending.map((m, i) => (
              <div key={m.id} className={`flex items-start gap-4 px-4 py-3 ${i < pending.length - 1 ? 'border-b border-white/[0.06]/50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-ink-4 font-mono">Ticket #{m.ticket_id}</span>
                    <span className="text-[10px] text-ink-4">·</span>
                    <span className="text-xs text-ink-3">par {m.sender_tag}</span>
                  </div>
                  <p className="text-sm text-ink-2 whitespace-pre-wrap break-words">{m.content}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-xs text-primary-light font-medium">{fmtDate(m.send_at, { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })}</p>
                    <p className="text-[10px] text-ink-4">envoi prévu</p>
                  </div>
                  <button onClick={() => cancel(m.id)}
                    className="p-1.5 rounded-lg text-ink-4 hover:text-red-400 hover:bg-red-600/10 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sent */}
      {sent.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">Envoyés récemment</h2>
          <div className="bg-surface-card border border-white/[0.06] rounded-xl overflow-hidden opacity-60">
            {sent.slice(0, 10).map((m, i) => (
              <div key={m.id} className={`flex items-start gap-4 px-4 py-3 ${i < sent.slice(0, 10).length - 1 ? 'border-b border-white/[0.06]/50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-ink-4 font-mono">Ticket #{m.ticket_id}</span>
                    <span className="text-xs text-emerald-600">✓ Envoyé</span>
                  </div>
                  <p className="text-sm text-ink-3 line-clamp-1">{m.content}</p>
                </div>
                <p className="text-xs text-ink-4 flex-shrink-0">{fmtDate(m.send_at)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
