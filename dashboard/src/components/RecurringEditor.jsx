import React, { useEffect, useState } from 'react';
import { Repeat, Loader2, Plus, Trash2, Play } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';

// Paramètres → Catalogue → Tickets récurrents (v5.3, utils/recurring.js)
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const FREQ = [['daily', 'Chaque jour'], ['weekdays', 'Les jours ouvrés (lun.–ven.)'], ['weekly', 'Chaque semaine'], ['monthly', 'Chaque mois']];
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function Form({ initial, ctx, busy, onSave, onDelete, onRun }) {
  const [r, setR] = useState(initial);
  const set = (k, v) => setR(x => ({ ...x, [k]: v }));
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2.5">
      <input value={r.name} onChange={e => set('name', e.target.value)} maxLength={80} placeholder="Contrôle des sauvegardes" aria-label="Nom de la récurrence" className={INPUT} />
      <textarea value={r.content} onChange={e => set('content', e.target.value)} rows={2} maxLength={2000} placeholder="Vérifier que les sauvegardes de la nuit sont complètes." aria-label="Premier message du ticket" className={INPUT} />
      <div className="grid gap-2 sm:grid-cols-4">
        <select value={r.frequency} onChange={e => set('frequency', e.target.value)} aria-label="Périodicité" className={INPUT}>{FREQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {r.frequency === 'weekly' && <select value={r.weekday} onChange={e => set('weekday', Number(e.target.value))} aria-label="Jour de la semaine" className={INPUT}>{DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select>}
        {r.frequency === 'monthly' && <select value={r.monthday} onChange={e => set('monthday', Number(e.target.value))} aria-label="Jour du mois" className={INPUT}>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{`Le ${i + 1}`}</option>)}</select>}
        <input type="time" value={r.time} onChange={e => set('time', e.target.value)} aria-label="Heure" className={INPUT} />
        <input value={r.timezone} onChange={e => set('timezone', e.target.value)} aria-label="Fuseau horaire" className={INPUT} />
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <select value={r.serviceId || ''} onChange={e => set('serviceId', e.target.value ? Number(e.target.value) : null)} aria-label="Service du catalogue" className={INPUT}><option value="">Service : aucun</option>{ctx.services.map(s => <option key={s.id} value={s.id}>{`Service : ${s.name}`}</option>)}</select>
        <select value={r.subject || ''} onChange={e => set('subject', e.target.value || null)} aria-label="Sujet du ticket" className={INPUT}><option value="">Sujet : le nom</option>{ctx.subjects.map(x => <option key={x} value={x}>{`Sujet : ${x}`}</option>)}</select>
        <select value={r.priority || ''} onChange={e => set('priority', e.target.value || null)} aria-label="Priorité du ticket" className={INPUT}><option value="">Priorité : normale</option><option value="low">Priorité : basse</option><option value="urgent">Priorité : urgente</option></select>
        <select value={r.teamId || ''} onChange={e => set('teamId', e.target.value ? Number(e.target.value) : null)} aria-label="Équipe du ticket" className={INPUT}><option value="">Équipe : selon les règles</option>{ctx.teams.map(t => <option key={t.id} value={t.id}>{`Équipe : ${t.name}`}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-2">
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={r.skipIfOpen} onChange={e => set('skipIfOpen', e.target.checked)} className="accent-primary" />Attendre que le précédent soit fermé</label>
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={r.active} onChange={e => set('active', e.target.checked)} className="accent-primary" />Active</label>
        {initial.nextRunAt && <span className="text-ink-4">{`Prochaine ouverture : ${new Date(initial.nextRunAt).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' })}`}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onSave(r)} disabled={busy || !r.name.trim() || !r.content.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 size={12} className="animate-spin" />}{initial.id ? 'Enregistrer' : 'Créer la récurrence'}
        </button>
        {onRun && <button onClick={onRun} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Play size={12} /> Ouvrir maintenant</button>}
        {onDelete && <button onClick={onDelete} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs text-ink-3 hover:text-red-400 border border-overlay/8 inline-flex items-center gap-1.5"><Trash2 size={12} /> Supprimer</button>}
      </div>
    </div>
  );
}

const NEW = { name: '', content: '', frequency: 'weekly', weekday: 1, monthday: 1, time: '09:00', timezone: 'Europe/Paris', serviceId: null, subject: null, priority: null, teamId: null, skipIfOpen: true, active: true };

export default function RecurringEditor() {
  const [list, setList] = useState(null);
  const [ctx, setCtx] = useState({ services: [], subjects: [], teams: [] });
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState(0);
  useEffect(() => {
    api.get('/recurring').then(r => setList(r.data.recurring)).catch(() => setList(false));
    Promise.all([api.get('/catalog'), api.get('/teams/options'), api.get('/teams')].map(p => p.catch(() => ({ data: null }))))
      .then(([c, o, t]) => setCtx({ services: c.data?.services || [], subjects: o.data?.subjects || [], teams: t.data || [] }));
  }, []);
  if (list === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (list === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); setList(r.data.recurring); toast.success(typeof ok === 'function' ? ok(r.data) : ok); setAdding(false); setKey(k => k + 1); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-ink-3 inline-flex items-start gap-2"><Repeat size={16} className="shrink-0 mt-0.5 text-primary-light" aria-hidden="true" />
        Des tickets ouverts tout seuls selon une périodicité (« contrôle des sauvegardes, chaque lundi à 9 h »). Ils viennent de « Ticket récurrent » : personne n'est prévenu par message, le staff les traite comme les autres.
      </p>
      {list.map(r => (
        <Form key={`${r.id}-${key}`} initial={r} ctx={ctx} busy={busy} onSave={b => run(() => api.put(`/recurring/${r.id}`, b), 'Récurrence enregistrée')}
          onRun={() => run(() => api.post(`/recurring/${r.id}/run`), d => `Ticket #${d.ticketId} ouvert`)}
          onDelete={() => window.confirm(`Supprimer la récurrence « ${r.name} » ?`) && run(() => api.delete(`/recurring/${r.id}`), 'Récurrence supprimée')} />
      ))}
      {adding ? <Form key={`new-${key}`} initial={NEW} ctx={ctx} busy={busy} onSave={b => run(() => api.post('/recurring', b), 'Récurrence créée')} onDelete={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)} className="px-3 py-2 rounded-lg text-xs font-semibold border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Plus size={13} /> Nouveau ticket récurrent</button>}
    </div>
  );
}
