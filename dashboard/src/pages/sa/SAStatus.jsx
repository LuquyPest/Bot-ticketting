import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, CheckCircle2, Trash2, ExternalLink } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../../utils/confirmToast';

const input = 'w-full px-3 py-2 rounded-xl bg-overlay/4 border border-overlay/8 text-sm text-ink-1 outline-hidden focus:border-primary/50';
const fmt = d => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const COMPONENT = { all: 'Tout le service', bot: 'Bot Discord', dashboard: 'Dashboard' };
const EMPTY = { kind: 'incident', component: 'all', severity: 'minor', title: '', message: '' };

// Incidents and maintenances shown on the public /status page (outages of the bot are added by
// the Discord watch on its own)
export default function SAStatus() {
  const [list, setList] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get('/sa/status-events').then(r => setList(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur')); }, []);
  useEffect(() => { load(); }, [load]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const publish = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.post('/sa/status-events', form); toast.success('Publié sur la page de statut'); setForm(EMPTY); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const resolve = async (ev) => {
    try { await api.patch(`/sa/status-events/${ev.id}`, { resolved: true }); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const remove = async (ev) => {
    if (!await confirmToast(`Supprimer « ${ev.title} » de l'historique public ?`)) return;
    try { await api.delete(`/sa/status-events/${ev.id}`); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-bold text-ink-1">Statut public</h1>
          <p className="text-sm text-ink-3">Incidents et maintenances affichés sur la page publique. Les coupures du bot détectées par la surveillance Discord y sont ajoutées et closes automatiquement.</p>
        </div>
        <a href="/status" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-ink-2 border border-overlay/8 hover:bg-overlay/5"><ExternalLink size={12} /> Voir la page</a>
      </div>

      <form onSubmit={publish} className="glass-dark rounded-2xl border border-overlay/8 p-5 space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-[11px] text-ink-3 space-y-1">Type
            <select value={form.kind} onChange={e => set('kind', e.target.value)} className={input}><option value="incident">Incident</option><option value="maintenance">Maintenance</option></select>
          </label>
          <label className="text-[11px] text-ink-3 space-y-1">Service concerné
            <select value={form.component} onChange={e => set('component', e.target.value)} className={input}>{Object.entries(COMPONENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="text-[11px] text-ink-3 space-y-1">Gravité
            <select value={form.severity} onChange={e => set('severity', e.target.value)} className={input}><option value="minor">Perturbation</option><option value="major">Interruption</option></select>
          </label>
        </div>
        <label className="block text-[11px] text-ink-3 space-y-1">Titre
          <input value={form.title} onChange={e => set('title', e.target.value)} maxLength={120} placeholder="Lenteurs à l'envoi des réponses" className={input} />
        </label>
        <label className="block text-[11px] text-ink-3 space-y-1">Message (facultatif)
          <textarea value={form.message} onChange={e => set('message', e.target.value)} maxLength={2000} rows={2} className={input} />
        </label>
        <button type="submit" disabled={busy || !form.title.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-primary disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Publier
        </button>
      </form>

      {!list ? <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-ink-3" /></div> : (
        <ul className="space-y-2">
          {list.length === 0 && <li className="text-sm text-ink-4">Aucun événement.</li>}
          {list.map(ev => (
            <li key={ev.id} className="glass-dark rounded-xl border border-overlay/8 px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-1 font-medium">{ev.title} {ev.auto ? <span className="text-[10px] text-ink-4">(automatique)</span> : null}</p>
                <p className="text-[11px] text-ink-4">{ev.kind === 'maintenance' ? 'Maintenance' : ev.severity === 'major' ? 'Interruption' : 'Perturbation'} · {COMPONENT[ev.component]} · {fmt(ev.started_at)} → {ev.resolved_at ? fmt(ev.resolved_at) : 'en cours'}</p>
              </div>
              {!ev.resolved_at && <button onClick={() => resolve(ev)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/10"><CheckCircle2 size={12} /> Résolu</button>}
              <button onClick={() => remove(ev)} aria-label={`Supprimer ${ev.title}`} className="p-1.5 text-ink-4 hover:text-red-400"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
