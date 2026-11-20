import React, { useEffect, useState } from 'react';
import { Activity, ExternalLink, Plus, Trash2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Incidents → Page de statut (v7, utils/statusPage.js): the public page of the space, its components
// and their state; the incidents marked « public » appear on it
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
export const STATUS_LABELS = { operational: 'Opérationnel', degraded: 'Dégradé', partial_outage: 'Panne partielle', major_outage: 'Panne majeure', maintenance: 'Maintenance' };

export default function StatusPageSettings({ canManage }) {
  const [s, setS] = useState(null);
  const [name, setName] = useState('');
  useEffect(() => { api.get('/status-page').then(r => setS(Array.isArray(r.data?.components) ? r.data : false)).catch(() => setS(false)); }, []);
  if (!s) return null;
  const act = async (p, ok) => { try { const r = await p; if (Array.isArray(r.data?.components)) setS(r.data); if (ok) toast.success(ok); return true; } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; } };
  return (
    <section className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-ink-1 inline-flex items-center gap-1.5"><Activity size={14} aria-hidden="true" />Page de statut publique</h2>
      <p className="text-xs text-ink-3">Une page publique montre l'état de tes services, les incidents publiés et leur disponibilité sur 90 jours ; on peut s'y abonner par e-mail.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-ink-1"><input type="checkbox" checked={s.enabled} disabled={!canManage} onChange={e => act(api.put('/status-page', { enabled: e.target.checked, title: s.title }), e.target.checked ? 'Page publiée' : 'Page retirée')} className="accent-primary" />Publier la page</label>
        {s.enabled && <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-light hover:underline inline-flex items-center gap-1">{s.url} <ExternalLink size={11} aria-hidden="true" /></a>}
        <span className="text-[11px] text-ink-4">{`${s.subscribers.confirmed} abonné(s)`}</span>
      </div>
      <input defaultValue={s.title} disabled={!canManage} onBlur={e => e.target.value !== s.title && act(api.put('/status-page', { enabled: s.enabled, title: e.target.value }), 'Enregistré')} maxLength={120} placeholder="Titre de la page (par défaut : le nom de l'espace)" aria-label="Titre de la page de statut" className={`${INPUT} max-w-md`} />
      <ul className="space-y-1.5">
        {s.components.map(c => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-ink-1 w-48 truncate">{c.name}</span>
            <select value={c.status} disabled={!canManage} onChange={e => act(api.patch(`/status-page/components/${c.id}/status`, { status: e.target.value }), 'État changé')} aria-label={`État de « ${c.name} »`} className={`${INPUT} w-44!`}>
              {s.states.map(k => <option key={k} value={k}>{STATUS_LABELS[k]}</option>)}
            </select>
            {canManage && <button type="button" onClick={() => window.confirm(`Supprimer « ${c.name} » ?`) && act(api.delete(`/status-page/components/${c.id}`))} aria-label={`Supprimer « ${c.name} »`} className="text-ink-4 hover:text-red-400"><Trash2 size={12} /></button>}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex gap-1.5 max-w-md">
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Nouveau composant (Site web, Messagerie…)" aria-label="Nouveau composant" className={INPUT} />
          <button type="button" disabled={!name.trim()} onClick={() => act(api.post('/status-page/components', { name })).then(ok => ok && setName(''))} aria-label="Ajouter le composant" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={12} /></button>
        </div>
      )}
    </section>
  );
}
