import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Send, Trash2 } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../../utils/confirmToast';

const input = 'w-full px-3 py-2 rounded-xl bg-overlay/4 border border-overlay/8 text-sm text-ink-1 outline-hidden focus:border-primary/50';
const fmt = d => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

export default function SAAnnouncements() {
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ title: '', body: '', level: 'info', showBanner: true, sendDm: false, endsAt: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get('/sa/announcements').then(r => setList(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur')); }, []);
  useEffect(() => { load(); }, [load]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const publish = async (e) => {
    e.preventDefault();
    if (form.sendDm && !await confirmToast('Envoyer un MP à tous les fondateurs de tous les serveurs ?')) return;
    setBusy(true);
    try {
      const { data } = await api.post('/sa/announcements', { ...form, endsAt: form.endsAt || null });
      toast.success(form.sendDm ? `Annonce publiée — envoi des MP à ${data.recipients} fondateur(s) en cours` : 'Annonce publiée');
      setForm({ title: '', body: '', level: 'info', showBanner: true, sendDm: false, endsAt: '' });
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const remove = async (a) => {
    if (!await confirmToast(`Retirer l'annonce « ${a.title} » ? (les MP déjà envoyés restent)`)) return;
    try { await api.delete(`/sa/announcements/${a.id}`); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-lg font-bold text-ink-1">Annonces</h1>
        <p className="text-sm text-ink-3">Message aux fondateurs de tous les serveurs : bandeau sur leur dashboard et/ou MP Discord (une seule fois par personne).</p>
      </div>
      <form onSubmit={publish} className="glass-dark rounded-2xl border border-overlay/8 p-5 space-y-3">
        <input value={form.title} onChange={e => set('title', e.target.value)} maxLength={120} placeholder="Titre (ex : Maintenance dimanche 22 h)" aria-label="Titre" className={input} />
        <textarea value={form.body} onChange={e => set('body', e.target.value)} maxLength={4000} rows={4} placeholder="Message" aria-label="Message" className={`${input} resize-none`} />
        <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
          <select value={form.level} onChange={e => set('level', e.target.value)} aria-label="Type" className="px-2 py-1.5 rounded-lg bg-overlay/4 border border-overlay/8 text-ink-1">
            <option value="info">Information</option><option value="warning">Avertissement</option>
          </select>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.showBanner} onChange={e => set('showBanner', e.target.checked)} /> Bandeau sur le dashboard</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.sendDm} onChange={e => set('sendDm', e.target.checked)} /> MP Discord</label>
          {form.showBanner && (
            <label className="flex items-center gap-1.5">Jusqu'au
              <input type="datetime-local" value={form.endsAt} onChange={e => set('endsAt', e.target.value)} className="px-2 py-1 rounded-lg bg-overlay/4 border border-overlay/8 text-ink-1" />
            </label>
          )}
          <button type="submit" disabled={busy || !form.title.trim() || !form.body.trim()}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-primary hover:bg-primary-light disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Publier
          </button>
        </div>
      </form>
      <div className="glass-dark rounded-2xl border border-overlay/8 overflow-hidden">
        {list === null ? <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-ink-3" /></div>
          : list.length === 0 ? <p className="py-10 text-center text-xs text-ink-4">Aucune annonce</p> : (
          <ul className="divide-y divide-overlay/5">
            {list.map(a => (
              <li key={a.id} className="px-5 py-3 flex gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-1">{a.title} <span className="text-[10px] text-ink-4 font-normal">{a.level === 'warning' ? 'avertissement' : 'information'}</span></p>
                  <p className="text-xs text-ink-3 whitespace-pre-wrap line-clamp-2">{a.body}</p>
                  <p className="text-[10px] text-ink-4 mt-1">
                    {fmt(a.created_at)} par {a.created_by} · {a.show_banner ? `bandeau${a.ends_at ? ` jusqu'au ${fmt(a.ends_at)}` : ''}` : 'sans bandeau'} · {a.send_dm ? `${a.dm_sent} MP envoyé(s)` : 'sans MP'}
                  </p>
                </div>
                <button onClick={() => remove(a)} aria-label={`Retirer ${a.title}`} className="p-1.5 rounded-lg text-ink-3 hover:text-red-400 hover:bg-red-400/10 self-start"><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
