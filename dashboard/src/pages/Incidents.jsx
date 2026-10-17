import React, { useEffect, useState } from 'react';
import { Megaphone, CheckCircle2, Users, Loader2, Pencil } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../utils/confirmToast';
import { fmtDate } from '../utils/format';

const FIELD = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary transition-colors';
const EMPTY = { title: '', message: '', subjects: [], notifyOnResolve: true };

// Known issues: their message is sent to every new ticket while they are open
export default function Incidents() {
  const [list, setList] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resolveMsg, setResolveMsg] = useState({});

  const load = () => api.get('/incidents').then(r => setList(r.data)).catch(() => setList([]));
  useEffect(() => {
    load();
    api.get('/config').then(r => setSubjects(r.data.ticketSubjects || [])).catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, subjects: form.subjects.length ? form.subjects : null };
      if (editing) await api.patch(`/incidents/${editing}`, body);
      else await api.post('/incidents', body);
      toast.success(editing ? 'Incident modifié' : 'Incident ouvert : il sera annoncé à chaque nouveau ticket concerné');
      setForm(EMPTY); setEditing(null); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };

  const resolve = async (inc) => {
    if (!await confirmToast(`Marquer « ${inc.title} » comme résolu ?${inc.notify_on_resolve && inc.members ? ` Les ${inc.members} membre(s) touché(s) seront prévenus.` : ''}`)) return;
    try {
      const { data } = await api.post(`/incidents/${inc.id}/resolve`, { message: resolveMsg[inc.id] || '' });
      toast.success(`Incident résolu${data.notified ? ` · ${data.notified} membre(s) prévenu(s)` : ''}`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  const edit = inc => { setEditing(inc.id); setForm({ title: inc.title, message: inc.message, subjects: inc.subjects || [], notifyOnResolve: inc.notify_on_resolve }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const toggleSubject = s => setForm(f => ({ ...f, subjects: f.subjects.includes(s) ? f.subjects.filter(x => x !== s) : [...f.subjects, s] }));
  const open = list?.filter(i => !i.resolved_at) || [];
  const past = list?.filter(i => i.resolved_at) || [];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1">Incidents</h1>
        <p className="text-sm text-ink-3 mt-0.5">Un problème connu ? Tant que l'incident est ouvert, son message est envoyé en MP à chaque nouveau ticket concerné, juste après le message de bienvenue.</p>
      </div>

      <section className="bg-surface-card border border-overlay/6 rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-ink-2">{editing ? 'Modifier l\'incident' : 'Nouvel incident'}</h2>
        <label className="block">
          <span className="text-sm text-ink-2 font-medium block mb-1">Titre</span>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} maxLength={120} placeholder="Paiements par carte indisponibles" className={FIELD} />
        </label>
        <label className="block">
          <span className="text-sm text-ink-2 font-medium block mb-1">Message aux membres</span>
          <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} maxLength={1500} rows={3}
            placeholder="Nous rencontrons un problème avec notre prestataire de paiement. Il est en cours de résolution, inutile de réessayer pour l'instant." className={FIELD} />
        </label>
        {subjects.length > 0 && (
          <fieldset>
            <legend className="text-sm text-ink-2 font-medium mb-1.5">Sujets concernés <span className="text-ink-4 font-normal">(aucun coché = tous les tickets)</span></legend>
            <div className="flex flex-wrap gap-2">
              {subjects.map(s => (
                <button key={s} type="button" onClick={() => toggleSubject(s)} aria-pressed={form.subjects.includes(s)}
                  className={`px-2.5 py-1 rounded-lg text-xs border ${form.subjects.includes(s) ? 'bg-primary/15 border-primary/40 text-primary-light' : 'bg-surface border-overlay/8 text-ink-3 hover:text-ink-1'}`}>
                  {s}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={form.notifyOnResolve} onChange={e => setForm(f => ({ ...f, notifyOnResolve: e.target.checked }))} />
          Prévenir les membres touchés quand l'incident est résolu
        </label>
        <div className="flex gap-2">
          <button onClick={save} disabled={busy || !form.title.trim() || !form.message.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />} {editing ? 'Enregistrer' : 'Ouvrir l\'incident'}
          </button>
          {editing && <button onClick={() => { setEditing(null); setForm(EMPTY); }} className="px-4 py-2 rounded-lg text-sm text-ink-3 hover:text-ink-1">Annuler</button>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-2">En cours</h2>
        {!list && <div className="h-20 rounded-2xl bg-overlay/2.5 animate-pulse" />}
        {list && !open.length && <p className="text-sm text-ink-4">Aucun incident en cours.</p>}
        {open.map(inc => (
          <article key={inc.id} className="bg-surface-card border border-amber-500/30 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-start gap-3">
              <Megaphone size={16} className="text-amber-400 mt-0.5" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-ink-1">{inc.title}</h3>
                <p className="text-xs text-ink-2 mt-1 whitespace-pre-wrap">{inc.message}</p>
                <p className="text-[11px] text-ink-4 mt-1.5">
                  Ouvert par {inc.created_by_tag} le {fmtDate(inc.created_at)} · {inc.subjects?.length ? `sujets : ${inc.subjects.join(', ')}` : 'tous les tickets'}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-semibold">
                <Users size={12} /> {inc.members} membre(s) touché(s)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={resolveMsg[inc.id] || ''} onChange={e => setResolveMsg(m => ({ ...m, [inc.id]: e.target.value }))}
                aria-label="Message de résolution" placeholder={inc.notify_on_resolve ? 'Message de résolution (optionnel)' : 'Les membres ne seront pas prévenus'}
                disabled={!inc.notify_on_resolve} className={`${FIELD} flex-1 min-w-48`} />
              <button onClick={() => edit(inc)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-overlay/8 text-xs text-ink-2 hover:text-ink-1"><Pencil size={12} /> Modifier</button>
              <button onClick={() => resolve(inc)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 text-xs font-semibold">
                <CheckCircle2 size={12} /> Résolu
              </button>
            </div>
          </article>
        ))}
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-2">Résolus</h2>
          <ul className="space-y-2">
            {past.map(inc => (
              <li key={inc.id} className="bg-surface-card border border-overlay/6 rounded-xl px-4 py-3 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
                <CheckCircle2 size={13} className="text-emerald-400" />
                <span className="text-ink-1 font-medium">{inc.title}</span>
                <span className="text-ink-4">{fmtDate(inc.created_at)} → {fmtDate(inc.resolved_at)}{inc.resolved_by_tag ? ` · ${inc.resolved_by_tag}` : ''}</span>
                <span className="ml-auto text-ink-3">{inc.members} membre(s) · {inc.tickets} ticket(s)</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
