import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Server, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Elements of the inventory linked to a ticket, a problem or a change (v7, utils/assetLinks.js).
// Shown only when the space uses the inventory.
const INPUT = 'w-full bg-surface border border-overlay/[0.07] text-ink-1 placeholder-ink-4 rounded-xl px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary/50';

export default function AssetLinksPanel({ type, targetId, panelCard, canEdit = true }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    api.get(`/assets/links/${type}/${targetId}`).then(r => setList(Array.isArray(r.data?.assets) ? r.data.assets : null)).catch(() => setList(null));
  }, [type, targetId]);
  useEffect(() => {
    if (!q.trim()) { setFound([]); return undefined; }
    const timer = setTimeout(() => api.get('/assets', { params: { q: q.trim(), limit: 8 } }).then(r => setFound(r.data?.assets || [])).catch(() => setFound([])), 300);
    return () => clearTimeout(timer);
  }, [q]);
  if (!list) return null;
  const act = async p => { try { const r = await p; if (Array.isArray(r.data?.assets)) setList(r.data.assets); setQ(''); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className={panelCard}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1.5 inline-flex items-center gap-1.5"><Server size={12} aria-hidden="true" />Éléments du parc</p>
      {list.length === 0 && <p className="text-xs text-ink-4 mb-1.5">Aucun élément.</p>}
      <ul className="space-y-1 mb-1.5">
        {list.map(a => (
          <li key={a.id} className="flex items-center gap-1.5 text-xs">
            <Link to={`/parc/${a.id}`} className="flex-1 min-w-0 truncate text-ink-2 hover:text-primary-light">{`${a.typeIcon ? `${a.typeIcon} ` : ''}${a.name}`} <span className="text-ink-4">{`· ${a.typeName}`}</span></Link>
            {canEdit && <button type="button" onClick={() => act(api.delete(`/assets/links/${type}/${targetId}/${a.id}`))} aria-label={`Retirer « ${a.name} »`} className="text-ink-4 hover:text-red-400"><X size={11} /></button>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="relative">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ajouter : nom, n° de série…" aria-label="Chercher un élément du parc à lier" className={INPUT} />
          {found.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-xl border border-overlay/8 bg-surface-elevated shadow-card max-h-48 overflow-y-auto">
              {found.map(a => <li key={a.id}><button type="button" onClick={() => act(api.post(`/assets/links/${type}/${targetId}`, { assetId: a.id }))} className="w-full text-left px-2.5 py-1.5 text-xs text-ink-2 hover:bg-overlay/5">{`${a.name} · ${a.typeName}${a.serial ? ` · ${a.serial}` : ''}`}</button></li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Impact of a change: the elements touched and those that depend on them, and their open tickets
export function ChangeImpact({ changeId }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/assets/impact/${changeId}`).then(r => setData(Array.isArray(r.data?.assets) ? r.data : null)).catch(() => setData(null)); }, [changeId]);
  if (!data || !data.assets.length) return null;
  return (
    <section className="space-y-1">
      <p className="text-[11px] font-semibold text-ink-3">{`Impact : ${data.assets.length} élément(s), ${data.tickets.length} ticket(s) ouvert(s)`}</p>
      <ul className="space-y-0.5">
        {data.assets.map(a => <li key={a.id} className="text-xs" style={{ paddingLeft: `${a.depth * 12}px` }}><Link to={`/parc/${a.id}`} className="text-ink-1 hover:underline">{a.name}</Link> <span className="text-ink-4">{[a.typeName, a.orgName, a.depth ? `dépend (niveau ${a.depth})` : 'touché'].filter(Boolean).join(' · ')}</span></li>)}
      </ul>
      {data.tickets.length > 0 && <p className="text-xs text-ink-3">{data.tickets.map(t => <Link key={t.id} to={`/tickets/${t.id}`} className="mr-2 text-primary-light hover:underline">{`#${t.id}`}</Link>)}</p>}
    </section>
  );
}
