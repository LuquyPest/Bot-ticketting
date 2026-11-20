import React, { useEffect, useState } from 'react';
import { GitBranch, ExternalLink, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Fiche ticket → Développement (v7, utils/devIntegrations.js): issues in GitHub, GitLab or Jira
const INPUT = 'w-full bg-surface border border-overlay/[0.07] text-ink-1 placeholder-ink-4 rounded-xl px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary/50';

export default function DevIssuesPanel({ ticket, panelCard, canEdit }) {
  const [d, setD] = useState(null);
  const [mode, setMode] = useState(null); // null | 'create' | 'link'
  const [f, setF] = useState({ provider: '', title: '', body: '', ref: '' });
  useEffect(() => { api.get(`/dev-integrations/tickets/${ticket.id}`).then(r => setD(Array.isArray(r.data?.issues) ? r.data : null)).catch(() => setD(null)); }, [ticket.id]);
  if (!d || (!d.issues.length && !d.providers.length)) return null;
  const act = async p => { try { const r = await p; if (Array.isArray(r.data?.issues)) setD(r.data); setMode(null); return true; } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; } };
  const open = m => { setMode(m); setF({ provider: d.providers[0]?.provider || '', title: ticket.subject || `Ticket #${ticket.id}`, body: `Ticket #${ticket.id}${ticket.subject ? ` : ${ticket.subject}` : ''}`, ref: '' }); };
  return (
    <div className={panelCard}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1.5 inline-flex items-center gap-1.5"><GitBranch size={12} aria-hidden="true" />Développement</p>
      <ul className="space-y-1 mb-1.5">
        {d.issues.map(i => (
          <li key={i.id} className="flex items-center gap-1.5 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${i.state === 'closed' ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden="true" />
            <a href={i.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-ink-2 hover:text-primary-light">{`${i.label} ${i.key} · ${i.title}`}</a>
            <span className="text-ink-4 shrink-0">{i.status || (i.state === 'closed' ? 'fermée' : 'ouverte')}</span>
            {canEdit && <button type="button" onClick={() => act(api.delete(`/dev-integrations/tickets/${ticket.id}/${i.id}`))} aria-label={`Retirer ${i.label} ${i.key}`} className="text-ink-4 hover:text-red-400"><X size={11} /></button>}
          </li>
        ))}
      </ul>
      {canEdit && d.providers.length > 0 && !mode && (
        <div className="flex gap-2 text-[11px]">
          <button type="button" onClick={() => open('create')} className="text-ink-3 hover:text-ink-1 underline">Créer une issue</button>
          <button type="button" onClick={() => open('link')} className="text-ink-3 hover:text-ink-1 underline">Lier une issue</button>
        </div>
      )}
      {mode && (
        <div className="space-y-1.5">
          <select value={f.provider} onChange={e => setF(x => ({ ...x, provider: e.target.value }))} aria-label="Outil" className={INPUT}>{d.providers.map(p => <option key={p.provider} value={p.provider}>{p.label}</option>)}</select>
          {mode === 'create' ? <>
            <input value={f.title} onChange={e => setF(x => ({ ...x, title: e.target.value }))} maxLength={250} aria-label="Titre de l'issue" className={INPUT} />
            <textarea value={f.body} onChange={e => setF(x => ({ ...x, body: e.target.value }))} rows={3} maxLength={10000} aria-label="Description de l'issue" className={INPUT} />
          </> : <input value={f.ref} onChange={e => setF(x => ({ ...x, ref: e.target.value }))} placeholder={f.provider === 'jira' ? 'ABC-12' : '#34'} aria-label="Numéro ou clé de l'issue" className={INPUT} />}
          <div className="flex gap-1.5">
            <button type="button" onClick={() => act(api.post(`/dev-integrations/tickets/${ticket.id}`, mode === 'create' ? { provider: f.provider, title: f.title, body: f.body } : { provider: f.provider, ref: f.ref }))}
              className="flex-1 py-1.5 text-xs rounded-lg bg-primary text-white">{mode === 'create' ? 'Créer' : 'Lier'}</button>
            <button type="button" onClick={() => setMode(null)} className="px-3 py-1.5 text-xs rounded-lg border border-overlay/8 text-ink-3">Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}
