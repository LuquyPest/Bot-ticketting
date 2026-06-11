import React, { useState } from 'react';
import { Send, Loader2, CheckCircle2, Users } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

export default function Newsletter() {
  const [subject, setSubject]   = useState('');
  const [message, setMessage]   = useState('');
  const [sending, setSending]   = useState(false);
  const [result, setResult]     = useState(null);

  const MAX_CHARS = 2000;

  const send = async () => {
    if (message.trim().length < 5) return toast.error('Message trop court (min 5 caractères)');
    setSending(true);
    setResult(null);
    try {
      const r = await api.post('/newsletter/send', {
        subject: subject.trim() || undefined,
        message: message.trim(),
      });
      setResult(r.data);
      toast.success(`Message envoyé à ${r.data.sent} membre(s)`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'envoi');
    } finally {
      setSending(false);
    }
  };

  const preview = subject.trim()
    ? `📢 **${subject.trim()}**\n\n${message}`
    : `📢 **Message de la direction**\n\n${message}`;

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1">Newsletter staff</h1>
        <p className="text-sm text-ink-3 mt-0.5">
          Envoie un DM Discord à tous les membres du staff qui ne sont pas en vacances
        </p>
      </div>

      {/* Result banner */}
      {result && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle2 size={16} className="text-emerald-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-emerald-300">Envoi terminé</p>
            <p className="text-emerald-400/70 mt-0.5">
              {result.sent} envoyés &bull; {result.failed} échecs &bull; {result.total} destinataires au total
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Compose form */}
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-ink-2">Rédaction</h3>

          <div>
            <label className="text-xs text-ink-3 block mb-1">Sujet <span className="text-ink-4">(optionnel)</span></label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="ex: Nouvelles règles de modération"
              maxLength={100}
              className="w-full bg-surface border border-white/[0.08] text-ink-1 rounded-lg px-3 py-2
                         text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-ink-4"
            />
          </div>

          <div>
            <label className="text-xs text-ink-3 block mb-1">Message</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Ton message ici..."
              maxLength={MAX_CHARS}
              rows={8}
              className="w-full bg-surface border border-white/[0.08] text-ink-1 rounded-lg px-3 py-2
                         text-sm focus:outline-none focus:border-primary transition-colors resize-none
                         placeholder:text-ink-4 leading-relaxed"
            />
            <p className="text-[10px] text-ink-4 text-right mt-1">{message.length}/{MAX_CHARS}</p>
          </div>

          <button
            onClick={send}
            disabled={sending || message.trim().length < 5}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold
                       text-white bg-primary hover:bg-primary-light disabled:opacity-60 transition-all"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? 'Envoi en cours…' : 'Envoyer aux membres du staff'}
          </button>
        </div>

        {/* Preview */}
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink-2">Aperçu Discord</h3>
            <Users size={12} className="text-ink-4" />
          </div>

          <div className="bg-[#313338] rounded-xl p-4 min-h-[180px] space-y-1">
            {/* Discord-style bot message mockup */}
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/40 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-primary-light">B</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-semibold text-white">Bot Ticket</span>
                  <span className="text-[10px] text-[#949cf7] bg-[#949cf7]/20 rounded px-1 py-0.5">BOT</span>
                </div>
                <div className="text-sm text-[#dbdee1] leading-relaxed whitespace-pre-wrap break-words">
                  {message.trim()
                    ? preview.replace(/\*\*(.*?)\*\*/g, '**$1**')
                    : <span className="text-[#6d757d] italic">Ton message apparaîtra ici</span>
                  }
                </div>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-ink-4">
            Le message sera envoyé en DM Discord à chaque membre du staff (hors mode vacances).
            Markdown Discord supporté : **gras**, *italique*, `code`, __souligné__.
          </p>
        </div>
      </div>
    </div>
  );
}
