import React, { useEffect, useState } from 'react';
import { BellRing, Loader2, Plus, Trash2, Eye } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Paramètres → Notifications (v5.2, utils/notifications.js): who is told of what, how; and the
// texts the requester receives, per language
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';
export const EVENT_LABELS = {
  ticket_created: 'Nouveau ticket', member_reply: 'Message du demandeur', staff_reply: 'Réponse du staff', note: 'Note interne', assigned: 'Attribution',
  stage: 'Changement de statut', closed: 'Fermeture', sla_breached: 'Objectif SLA dépassé',
};
const RECIPIENT_LABELS = { assignee: 'La personne attribuée', assignees: 'Les personnes attribuées', followers: 'Les observateurs', team: 'L\'équipe du ticket', founders: 'Les fondateurs', emails: 'Des adresses' };
export const CHANNEL_LABELS = { dashboard: 'Dashboard et navigateur', discord: 'MP Discord', email: 'E-mail', slack: 'Canal Slack', teams: 'Canal Teams' };
const KEY_LABELS = {
  'welcome.default': 'Ticket créé', 'staffOpen.title': 'Le staff ouvre un ticket : titre', 'staffOpen.body': 'Le staff ouvre un ticket : texte',
  'stage.open.title': 'De nouveau en file : titre', 'stage.open.body': 'De nouveau en file : texte', 'stage.waiting.title': 'En attente : titre', 'stage.waiting.body': 'En attente : texte',
  'stage.in_progress.title': 'En cours : titre', 'stage.in_progress.body': 'En cours : texte', 'resolution.title': 'Solution proposée : titre', 'resolution.body': 'Solution proposée : texte',
  'hours.closedTitle': 'Hors horaires : titre', 'hours.closedBody': 'Hors horaires : texte', 'hours.closedNoDate': 'Hors horaires, sans date : texte', 'closed.title': 'Ticket fermé : titre', 'closed.body': 'Ticket fermé : texte',
};
const LANG_LABELS = { fr: 'Français', en: 'English', es: 'Español', de: 'Deutsch', it: 'Italiano', pt: 'Português' };

function Chips({ options, value, onChange, label }) {
  return (
    <span className="inline-flex flex-wrap gap-1" role="group" aria-label={label}>
      {options.map(([v, l]) => {
        const on = value.includes(v);
        return <button key={v} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter(x => x !== v) : [...value, v])}
          className={`px-2 py-0.5 rounded-md text-[11px] border ${on ? 'bg-primary/15 text-primary-light border-primary/40' : 'border-overlay/8 text-ink-3 hover:text-ink-1'}`}>{l}</button>;
      })}
    </span>
  );
}

function Rules() {
  const [rules, setRules] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/notifications').then(r => setRules(r.data.rules)).catch(() => setRules(false)); }, []);
  if (rules === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (rules === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const set = (i, k, v) => setRules(rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    setBusy(true);
    try { setRules((await api.put('/notifications/rules', { rules })).data.rules); toast.success('Notifications enregistrées'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <div className="space-y-2">
      {rules.map((r, i) => (
        <div key={i} className="bg-surface-card border border-overlay/6 rounded-xl p-3 space-y-2" role="group" aria-label={`Notification ${i + 1}`}>
          <div className="flex flex-wrap items-center gap-2">
            <select value={r.event} onChange={e => set(i, 'event', e.target.value)} aria-label="Événement" className={INPUT}>
              {Object.entries(EVENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="inline-flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" checked={r.active} onChange={e => set(i, 'active', e.target.checked)} className="accent-primary" />Active</label>
            <label className="inline-flex items-center gap-1 text-xs text-ink-2" title="Personne ne peut la couper dans son profil"><input type="checkbox" checked={r.imposed} onChange={e => set(i, 'imposed', e.target.checked)} className="accent-primary" />Imposée</label>
            <button type="button" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Retirer la notification" className="ml-auto p-1 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-4">À
            <Chips label="Destinataires" options={Object.entries(RECIPIENT_LABELS).filter(([v]) => v !== 'assignee' || r.event === 'assigned')} value={r.recipients} onChange={v => set(i, 'recipients', v)} />
          </div>
          {r.recipients.includes('emails') && (
            <input value={(r.emails || []).join(', ')} onChange={e => set(i, 'emails', e.target.value.split(',').map(x => x.trim()).filter(Boolean))} placeholder="astreinte@exemple.fr" aria-label="Adresses e-mail" className={`${INPUT} w-full`} />
          )}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-4">Par
            <Chips label="Canaux" options={Object.entries(CHANNEL_LABELS)} value={r.channels} onChange={v => set(i, 'channels', v)} />
          </div>
          {r.channels.some(c => c === 'slack' || c === 'teams') && <p className="text-[11px] text-ink-4">Slack et Teams : un message dans le canal de l'espace (Paramètres → Intégrations), quels que soient les destinataires.</p>}
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" onClick={() => setRules([...rules, { event: 'ticket_created', recipients: ['founders'], channels: ['dashboard'], emails: [], imposed: false, active: true }])}
          className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Plus size={12} /> Ajouter une notification</button>
        <button type="button" onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 size={12} className="animate-spin" />}Enregistrer les notifications
        </button>
      </div>
    </div>
  );
}

function Templates() {
  const [list, setList] = useState(null);
  const [key, setKey] = useState('closed.body');
  const [lang, setLang] = useState('fr');
  const [draft, setDraft] = useState('');
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/notifications/templates').then(r => setList(r.data.templates)).catch(() => setList(false)); }, []);
  const cur = list && list.find(x => x.key === key);
  useEffect(() => { if (cur) { setDraft(cur.texts[lang]?.custom || ''); setShown(null); } }, [key, lang, list]); // eslint-disable-line react-hooks/exhaustive-deps
  if (list === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (list === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const save = async text => {
    setBusy(true);
    try { setList((await api.put('/notifications/templates', { texts: [{ key, lang, text }] })).data.templates); toast.success(text ? 'Texte enregistré' : 'Texte standard rétabli'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const preview = async () => setShown((await api.post('/notifications/templates/preview', { text: draft || cur.texts[lang].default })).data.text);
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2.5">
      <div className="flex flex-wrap gap-2">
        <select value={key} onChange={e => setKey(e.target.value)} aria-label="Message" className={INPUT}>
          {list.map(x => <option key={x.key} value={x.key}>{`${KEY_LABELS[x.key] || x.key}${Object.values(x.texts).some(v => v.custom) ? ' ✎' : ''}`}</option>)}
        </select>
        <select value={lang} onChange={e => setLang(e.target.value)} aria-label="Langue" className={INPUT}>
          {Object.entries(LANG_LABELS).map(([v, l]) => <option key={v} value={v}>{`${l}${cur?.texts[v]?.custom ? ' ✎' : ''}`}</option>)}
        </select>
      </div>
      <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} maxLength={1500} placeholder={cur?.texts[lang]?.default} aria-label="Texte personnalisé" className={`${INPUT} w-full`} />
      <p className="text-[11px] text-ink-4">{cur?.variables.length ? `Variables : ${cur.variables.map(v => `{${v}}`).join(' ')}. ` : ''}Vide = le texte standard (affiché en gris).</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => save(draft)} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Enregistrer le texte</button>
        {cur?.texts[lang]?.custom && <button type="button" onClick={() => save('')} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-3 hover:text-ink-1">Revenir au texte standard</button>}
        <button type="button" onClick={preview} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Eye size={12} /> Aperçu</button>
      </div>
      {shown !== null && <p className="text-xs text-ink-2 whitespace-pre-wrap border border-overlay/8 rounded-lg p-2" role="status">{shown}</p>}
    </div>
  );
}

export default function NotificationsEditor() {
  return (
    <div className="space-y-5 max-w-4xl">
      <p className="text-sm text-ink-3 inline-flex items-start gap-2"><BellRing size={16} className="shrink-0 mt-0.5 text-primary-light" aria-hidden="true" />
        Qui est prévenu de quoi, et comment. Chacun peut couper dans son profil ce qui n'est pas imposé. Personne n'est prévenu d'un ticket qu'il ne voit pas, ni de sa propre action.
      </p>
      <Rules />
      <h2 className="text-sm font-semibold text-ink-1 pt-2">Messages envoyés au demandeur</h2>
      <p className="text-xs text-ink-3">Réécris les messages automatiques dans chacune des 6 langues ; le demandeur reçoit celle de sa langue.</p>
      <Templates />
    </div>
  );
}
