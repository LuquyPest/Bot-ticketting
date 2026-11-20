import React, { useEffect, useState } from 'react';
import { Loader2, Copy, RefreshCw, ExternalLink } from 'lucide-react';
import WidgetBotEditor from './WidgetBotEditor';
import api from '../api';
import toast from 'react-hot-toast';

const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary';

// Paramètres → Intégrations → Widget web (v4.1): a ticket form to paste on a site. Saved on its
// own, like the e-mail settings.
export default function WidgetSettings() {
  const [s, setS] = useState(null);
  const [origins, setOrigins] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = data => { setS(data); setOrigins((data.origins || []).join('\n')); };
  useEffect(() => { api.get('/widget-settings').then(r => apply(r.data)).catch(() => setS(false)); }, []);
  if (s === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (s === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const run = async (fn, ok) => {
    setBusy(true);
    try { apply((await fn()).data); toast.success(ok); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const save = () => run(() => api.put('/widget-settings', { enabled: !!s.enabled, origins, chat: !!s.chat }), s.enabled ? 'Widget activé' : 'Widget désactivé');
  const regenerate = () => {
    if (!window.confirm('Créer un nouveau code ? Le code déjà collé sur tes sites cessera de fonctionner.')) return;
    run(() => api.post('/widget-settings/token'), 'Nouveau code créé');
  };
  const copy = text => navigator.clipboard?.writeText(text).then(() => toast.success('Copié'));
  return (
    <div className="space-y-3">
      {!s.mailReady && (
        <p className="text-xs text-amber-400">L'e-mail de l'instance n'est pas configuré (Instance → Santé) : le formulaire reste indisponible, puisque la confirmation et les réponses partent par e-mail.</p>
      )}
      <label className="flex items-center gap-2 text-sm text-ink-1">
        <input type="checkbox" checked={!!s.enabled} onChange={e => setS(x => ({ ...x, enabled: e.target.checked }))} className="accent-primary" />
        Activer le widget
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-1">
        <input type="checkbox" checked={!!s.chat} onChange={e => setS(x => ({ ...x, chat: e.target.checked }))} className="accent-primary" />
        Proposer le chat en direct quand quelqu'un de l'équipe est « Disponible » (sinon, le formulaire)
      </label>
      {s.enabled && s.token && <div className="border-t border-overlay/6 pt-3"><WidgetBotEditor /></div>}
      <label className="block text-xs text-ink-3">Sites autorisés à afficher le formulaire (un par ligne ; vide = tous)
        <textarea value={origins} onChange={e => setOrigins(e.target.value)} rows={3} placeholder="https://exemple.com" className={`${INPUT} mt-1 font-mono text-xs`} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Enregistrer</button>
        {s.token && (
          <button onClick={regenerate} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-3 hover:text-ink-1 inline-flex items-center gap-1.5">
            <RefreshCw size={12} aria-hidden="true" /> Nouveau code
          </button>
        )}
      </div>
      {s.enabled && s.snippet && (
        <div className="space-y-2">
          <p className="text-xs text-ink-3">Colle ce code avant la fin de la balise <code translate="no">&lt;body&gt;</code> de ton site : un bouton « Support » ouvre le formulaire. Options : <code translate="no">data-label</code> (texte du bouton), <code translate="no">data-color</code>, <code translate="no">data-lang</code>, <code translate="no">data-mode="inline"</code> (formulaire dans la page).</p>
          <div className="flex items-start gap-1.5">
            <code className="flex-1 min-w-0 break-all bg-overlay/4 rounded-lg px-2.5 py-2 text-xs text-ink-2" translate="no">{s.snippet}</code>
            <button type="button" aria-label="Copier" title="Copier" onClick={() => copy(s.snippet)} className="p-1.5 rounded-lg border border-overlay/8 text-ink-3 hover:text-ink-1"><Copy size={12} /></button>
          </div>
          <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary-light hover:underline">
            <ExternalLink size={12} aria-hidden="true" /> Voir le formulaire
          </a>
        </div>
      )}
      <p className="text-xs text-ink-4">Le demandeur indique son adresse e-mail ; il reçoit une confirmation et les réponses par e-mail, et suit son ticket dans l'espace membre. Anti-spam : champ piège, délai minimal de saisie, 5 envois par heure et par adresse IP, 3 par adresse e-mail, et la limite de tickets par jour de l'espace.</p>
    </div>
  );
}
