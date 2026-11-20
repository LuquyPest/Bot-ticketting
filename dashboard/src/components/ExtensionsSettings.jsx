import React, { useEffect, useState } from 'react';
import { Puzzle, Trash2 } from 'lucide-react';
import api from '../api';
import TestButton from './TestButton';
import toast from 'react-hot-toast';

// Paramètres → Intégrations → Extensions (v7, utils/extensions.js): founders
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const EXAMPLE = '{\n  "name": "Mon extension",\n  "version": "1.0.0",\n  "panel": { "url": "https://extension.example.com/panneau", "height": 240 },\n  "permissions": ["read_tickets"],\n  "webhook": { "url": "https://extension.example.com/evenements", "events": ["ticket_open", "ticket_close"] }\n}';

export default function ExtensionsSettings() {
  const [d, setD] = useState(null);
  const [src, setSrc] = useState('');
  const [secrets, setSecrets] = useState(null);
  useEffect(() => { api.get('/extensions').then(r => setD(r.data?.permissions ? r.data : false)).catch(() => setD(false)); }, []);
  if (!d) return null;
  const install = async () => {
    try {
      const body = /^https:\/\//.test(src.trim()) ? { manifestUrl: src.trim() } : { manifest: src };
      const r = await api.post('/extensions', body);
      setSecrets({ name: r.data.extension.name, apiKey: r.data.apiKey, webhookSecret: r.data.webhookSecret }); setSrc('');
      setD((await api.get('/extensions')).data); toast.success('Extension installée');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const act = async p => { try { const r = await p; if (r.data?.extensions) setD(x => ({ ...x, extensions: r.data.extensions })); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-ink-3 inline-flex items-center gap-1.5"><Puzzle size={13} aria-hidden="true" />Une extension ajoute un panneau à la fiche ticket (dans un cadre isolé), reçoit les événements choisis, et appelle l'API v3 avec une clé limitée à ses permissions.</p>
      <ul className="space-y-1.5">
        {d.extensions.map(e => (
          <li key={e.id} className="rounded-xl border border-overlay/8 p-2.5 text-xs flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink-1" translate="no">{`${e.name}${e.version ? ` ${e.version}` : ''}`}</span>
            <span className="text-ink-4">{[e.panel && 'panneau', e.webhook && `webhook (${e.webhook.events.join(', ')})`, e.permissions.length && `API : ${e.permissions.join(', ')}`].filter(Boolean).join(' · ')}</span>
            {e.webhook && <TestButton url={`/extensions/${e.id}/test`} label="Tester le webhook" />}
            <button type="button" onClick={() => act(api.patch(`/extensions/${e.id}`, { active: !e.active }))} className="ml-auto text-ink-3 hover:text-ink-1 underline">{e.active ? 'Couper' : 'Activer'}</button>
            <button type="button" onClick={() => window.confirm(`Supprimer l'extension « ${e.name} » ? Sa clé API cesse aussitôt de marcher.`) && act(api.delete(`/extensions/${e.id}`))} aria-label={`Supprimer l'extension « ${e.name} »`} className="text-ink-4 hover:text-red-400"><Trash2 size={12} /></button>
          </li>
        ))}
      </ul>
      {secrets && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-3 text-xs space-y-1" role="status">
          <p className="font-semibold text-ink-1">{`À donner à « ${secrets.name} », affiché une seule fois :`}</p>
          {secrets.apiKey && <p>Clé API : <code className="break-all" translate="no">{secrets.apiKey}</code></p>}
          {secrets.webhookSecret && <p>Secret des webhooks (signature X-Datick-Signature-256) : <code className="break-all" translate="no">{secrets.webhookSecret}</code></p>}
          <button type="button" onClick={() => setSecrets(null)} className="underline text-ink-3">J'ai noté</button>
        </div>
      )}
      <textarea value={src} onChange={e => setSrc(e.target.value)} rows={6} placeholder={EXAMPLE} aria-label="Manifeste de l'extension (JSON) ou son adresse https" className={`${INPUT} font-mono`} />
      <button type="button" disabled={!src.trim()} onClick={install} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Installer</button>
    </div>
  );
}
