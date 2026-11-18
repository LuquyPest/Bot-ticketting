import React, { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Plus, Trash2, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';

// Paramètres → Horaires (v5.1): the calendars of the space — opening hours per day, time zone,
// closed days (public holidays of a country, closing periods), the message sent outside the hours.
// The space uses one; a team can have its own (Équipe → Équipes).
const DAYS = [['mon', 'Lundi'], ['tue', 'Mardi'], ['wed', 'Mercredi'], ['thu', 'Jeudi'], ['fri', 'Vendredi'], ['sat', 'Samedi'], ['sun', 'Dimanche']];
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const COUNTRIES = { FR: 'France', BE: 'Belgique', CH: 'Suisse', LU: 'Luxembourg', CA: 'Canada', US: 'États-Unis', GB: 'Royaume-Uni', DE: 'Allemagne' };
const NEW = () => ({ name: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris', hours: Object.fromEntries(DAYS.map(([d]) => [d, ['sat', 'sun'].includes(d) ? [] : [['09:00', '18:00']]])), closed: [], outsideReply: false, outsideText: '' });

function CalendarForm({ initial, onSave, onDelete, busy }) {
  const [c, setC] = useState(initial);
  const [country, setCountry] = useState('FR');
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));
  const setRange = (d, i, j, v) => set('hours', { ...c.hours, [d]: c.hours[d].map((r, k) => (k === i ? r.map((x, l) => (l === j ? v : x)) : r)) });
  const addHolidays = async () => {
    const year = new Date().getFullYear();
    try {
      const lists = await Promise.all([year, year + 1].map(y => api.get('/calendars/holidays', { params: { country, year: y } }).then(r => r.data)));
      const known = new Set(c.closed.map(x => x.from));
      set('closed', [...c.closed, ...lists.flat().filter(h => !known.has(h.from))].sort((a, b) => (a.from < b.from ? -1 : 1)));
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={c.name} onChange={e => set('name', e.target.value)} maxLength={60} placeholder="Horaires du support" aria-label="Nom du calendrier" className={`${INPUT} flex-1 min-w-40`} />
        <input value={c.timezone} onChange={e => set('timezone', e.target.value)} maxLength={64} aria-label="Fuseau horaire" title="Fuseau horaire (ex. Europe/Paris, America/Montreal)" className={`${INPUT} w-44`} />
        {initial.id && (c.openNow !== undefined) && <span className={`text-[11px] ${c.openNow ? 'text-emerald-300' : 'text-ink-3'}`}>{c.openNow ? 'Ouvert en ce moment' : c.nextOpening ? `Fermé · réouverture ${new Date(c.nextOpening).toLocaleString(uiLocale(), { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` : 'Fermé'}</span>}
      </div>
      <table className="text-xs">
        <tbody>
          {DAYS.map(([d, label]) => (
            <tr key={d}>
              <th scope="row" className="text-left text-ink-3 font-medium pr-3 py-1 align-top">{label}</th>
              <td className="py-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {!c.hours[d]?.length && <span className="text-ink-4">Fermé</span>}
                  {(c.hours[d] || []).map((r, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      <input type="time" value={r[0]} onChange={e => setRange(d, i, 0, e.target.value)} aria-label={`${label}, début de la plage ${i + 1}`} className={INPUT} />
                      –
                      <input type="time" value={r[1] === '24:00' ? '23:59' : r[1]} onChange={e => setRange(d, i, 1, e.target.value === '23:59' ? '24:00' : e.target.value)} aria-label={`${label}, fin de la plage ${i + 1}`} className={INPUT} />
                      <button type="button" onClick={() => set('hours', { ...c.hours, [d]: c.hours[d].filter((_, k) => k !== i) })} aria-label={`Retirer la plage ${i + 1} du ${label.toLowerCase()}`} className="p-1 text-ink-4 hover:text-red-400"><X size={11} /></button>
                    </span>
                  ))}
                  {(c.hours[d] || []).length < 4 && (
                    <button type="button" onClick={() => set('hours', { ...c.hours, [d]: [...(c.hours[d] || []), ['14:00', '18:00']] })} aria-label={`Ajouter une plage le ${label.toLowerCase()}`} className="p-1 text-ink-3 hover:text-ink-1"><Plus size={12} /></button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-ink-3">Jours fermés ({c.closed.length})</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={country} onChange={e => setCountry(e.target.value)} aria-label="Pays des jours fériés" className={INPUT}>
            {Object.entries(COUNTRIES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
          <button type="button" onClick={addHolidays} className="px-2 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2 hover:text-ink-1">Ajouter les jours fériés (cette année et la suivante)</button>
          <button type="button" onClick={() => { const d = new Date().toISOString().slice(0, 10); set('closed', [...c.closed, { from: d, to: d, label: 'Fermeture' }]); }} className="px-2 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2 hover:text-ink-1">Ajouter une fermeture</button>
        </div>
        {c.closed.length > 0 && (
          <ul className="max-h-48 overflow-y-auto space-y-1" tabIndex={0} aria-label="Jours fermés">
            {c.closed.map((x, i) => (
              <li key={`${x.from}${i}`} className="flex flex-wrap items-center gap-1.5 text-xs">
                <input type="date" value={x.from} onChange={e => set('closed', c.closed.map((y, k) => (k === i ? { ...y, from: e.target.value, to: y.to < e.target.value ? e.target.value : y.to } : y)))} aria-label="Du" className={INPUT} />
                <input type="date" value={x.to} min={x.from} onChange={e => set('closed', c.closed.map((y, k) => (k === i ? { ...y, to: e.target.value } : y)))} aria-label="Au" className={INPUT} />
                <input value={x.label} onChange={e => set('closed', c.closed.map((y, k) => (k === i ? { ...y, label: e.target.value } : y)))} maxLength={60} aria-label="Nom" className={`${INPUT} flex-1 min-w-32`} />
                <button type="button" onClick={() => set('closed', c.closed.filter((_, k) => k !== i))} aria-label={`Retirer ${x.label || x.from}`} className="p-1 text-ink-4 hover:text-red-400"><X size={11} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-ink-1">
        <input type="checkbox" checked={c.outsideReply} onChange={e => set('outsideReply', e.target.checked)} className="accent-primary" />
        Prévenir le demandeur qui ouvre un ticket hors horaires (« le support est fermé, nous revenons le … »)
      </label>
      {c.outsideReply && (
        <textarea value={c.outsideText} onChange={e => set('outsideText', e.target.value)} rows={2} maxLength={1000} placeholder="Message personnalisé (facultatif ; sinon le message standard dans la langue du demandeur, avec la réouverture)" aria-label="Message hors horaires" className={`${INPUT} w-full`} />
      )}
      <div className="flex gap-2">
        <button onClick={() => onSave(c)} disabled={busy || !c.name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 size={12} className="animate-spin" />}{initial.id ? 'Enregistrer' : 'Créer le calendrier'}
        </button>
        {onDelete && <button onClick={onDelete} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs text-ink-3 hover:text-red-400 border border-overlay/8 inline-flex items-center gap-1.5"><Trash2 size={12} /> Supprimer</button>}
      </div>
    </div>
  );
}

export default function CalendarsEditor() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState(0);
  const load = () => api.get('/calendars').then(r => setData(r.data)).catch(() => setData(false));
  useEffect(() => { load(); }, []);
  if (data === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (data === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setAdding(false); setKey(k => k + 1); await load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const body = c => ({ name: c.name, timezone: c.timezone, hours: c.hours, closed: c.closed.map(({ from, to, label }) => ({ from, to, label })), outsideReply: c.outsideReply, outsideText: c.outsideText });
  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-ink-3 inline-flex items-start gap-2"><CalendarClock size={16} className="shrink-0 mt-0.5 text-primary-light" aria-hidden="true" />
        Les horaires d'ouverture du support. Sans calendrier, le support est considéré ouvert tout le temps. Une équipe peut avoir les siens (Équipe → Équipes).
      </p>
      <label className="flex flex-wrap items-center gap-2 text-sm text-ink-1">Horaires de l'espace
        <select value={data.spaceCalendarId || ''} onChange={e => run(() => api.patch('/config', { calendarId: e.target.value ? Number(e.target.value) : null }), 'Horaires de l\'espace enregistrés')} className={INPUT}>
          <option value="">Toujours ouvert</option>
          {data.calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {data.calendars.map(c => (
        <CalendarForm key={`${c.id}-${key}`} initial={c} busy={busy} onSave={v => run(() => api.put(`/calendars/${c.id}`, body(v)), 'Calendrier enregistré')}
          onDelete={() => window.confirm(`Supprimer le calendrier « ${c.name} » ?`) && run(() => api.delete(`/calendars/${c.id}`), 'Calendrier supprimé')} />
      ))}
      {adding ? <CalendarForm key={`new-${key}`} initial={NEW()} busy={busy} onSave={v => run(() => api.post('/calendars', body(v)), 'Calendrier créé')} onDelete={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)} className="px-3 py-2 rounded-lg text-xs font-semibold border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Plus size={13} /> Nouveau calendrier</button>}
    </div>
  );
}
