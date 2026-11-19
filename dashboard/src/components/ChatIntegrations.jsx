import React, { useEffect, useState } from 'react';
import { Loader2, Send, Copy } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Paramètres → Intégrations → Slack et Microsoft Teams (v5.2, utils/chatIntegrations.js)
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';

function One({ kind, state, onSaved }) {
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [active, setActive] = useState(state.active);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { active, ...(url ? { webhookUrl: url } : {}), ...(kind === 'slack' && secret ? { signingSecret: secret } : {}) };
      onSaved((await api.put(`/chat/${kind}`, body)).data); setUrl(''); setSecret(''); toast.success('Enregistré');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const test = async () => { try { await api.post(`/chat/${kind}/test`); toast.success('Message de test envoyé'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const name = kind === 'slack' ? 'Slack' : 'Microsoft Teams';
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-ink-1 flex-1">{name}</p>
        <span className={`text-[11px] ${state.configured ? 'text-emerald-300' : 'text-ink-4'}`}>{state.configured ? (state.active ? 'Relié' : 'Relié, en pause') : 'Non relié'}</span>
      </div>
      <label className="block text-[11px] font-semibold text-ink-3">{kind === 'slack' ? 'Adresse du webhook entrant (Incoming Webhooks)' : 'Adresse du webhook entrant (Workflows → « publier dans un canal quand un webhook est reçu »)'}
        <input type="password" autoComplete="off" value={url} onChange={e => setUrl(e.target.value)} placeholder={state.configured ? '•••••• (laisser vide pour garder)' : kind === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://….webhook.office.com/…'} className={`${INPUT} mt-1 font-normal`} />
      </label>
      {kind === 'slack' && (
        <>
          <label className="block text-[11px] font-semibold text-ink-3">Signing secret de l'app Slack (pour le bouton « Prendre »)
            <input type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} placeholder={state.hasSecret ? '•••••• (laisser vide pour garder)' : 'Basic Information → App Credentials'} className={`${INPUT} mt-1 font-normal`} />
          </label>
          <div className="text-[11px] text-ink-4 flex flex-wrap items-center gap-1.5">Interactivity → Request URL :
            <code className="px-1 rounded bg-overlay/6 text-ink-2 break-all">{state.actionUrl}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(state.actionUrl).then(() => toast.success('Copié'))} aria-label="Copier l'adresse des actions Slack" className="p-1 text-ink-3 hover:text-ink-1"><Copy size={11} /></button>
          </div>
          <p className="text-[11px] text-ink-4">La première fois qu'une personne clique sur « Prendre », Slack lui donne un lien pour relier son compte ; ensuite le bouton agit avec ses droits.</p>
        </>
      )}
      {kind === 'teams' && <p className="text-[11px] text-ink-4">Teams ne renvoie pas les clics d'un webhook : « Prendre » et « Répondre » ouvrent le ticket dans le dashboard.</p>}
      <label className="flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-primary" />Actif</label>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5">{busy && <Loader2 size={12} className="animate-spin" />}Enregistrer</button>
        {state.configured && <button type="button" onClick={test} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Send size={12} /> Tester</button>}
      </div>
    </div>
  );
}

export default function ChatIntegrations() {
  const [state, setState] = useState(null);
  useEffect(() => { api.get('/chat').then(r => setState(r.data)).catch(() => setState(false)); }, []);
  if (state === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (!state) return <p className="text-xs text-ink-4">Indisponible.</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3">Les notifications d'équipe se choisissent dans Paramètres → Notifications (canal « Slack » ou « Teams »).</p>
      <div className="grid gap-3 lg:grid-cols-2">
        <One kind="slack" state={state.slack} onSaved={setState} />
        <One kind="teams" state={state.teams} onSaved={setState} />
      </div>
    </div>
  );
}
