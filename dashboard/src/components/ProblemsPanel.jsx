import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bug } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { PROBLEM_STATUS } from '../pages/Problems';

// Fiche ticket → Problèmes (v5.5): the problems it is linked to, and their workaround to insert
export default function ProblemsPanel({ ticketId, panelCard, onInsert, canEdit }) {
  const [list, setList] = useState(null);
  const [all, setAll] = useState([]);
  const ok = d => (Array.isArray(d?.problems) ? d.problems : null);
  const load = () => api.get(`/problems/ticket/${ticketId}`).then(r => setList(ok(r.data))).catch(() => setList(null));
  useEffect(() => { load(); }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return null; // off, or not reachable
  const pick = async () => { if (!all.length) api.get('/problems').then(r => setAll(ok(r.data) || [])).catch(() => {}); };
  const linkTo = async id => { try { await api.post(`/problems/${id}/tickets`, { ticketId }); toast.success('Ticket relié au problème'); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className={panelCard}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-2 inline-flex items-center gap-1.5"><Bug size={12} aria-hidden="true" />Problèmes</p>
      {list.map(p => (
        <div key={p.id} className="text-xs space-y-1 mb-2">
          <Link to={`/problemes/${p.id}`} className="text-ink-1 hover:underline">{p.title}</Link> <span className="text-ink-4">{`· ${PROBLEM_STATUS[p.status]}`}</span>
          {p.workaround && <div className="rounded-lg bg-overlay/4 p-2 text-ink-2"><p className="text-[11px] text-ink-4">Contournement</p><p className="whitespace-pre-wrap">{p.workaround}</p>
            {canEdit && onInsert && <button type="button" onClick={() => onInsert(p.workaround)} className="mt-1 text-[11px] text-primary-light underline">Insérer dans la réponse</button>}</div>}
        </div>
      ))}
      {canEdit && (
        <select value="" onFocus={pick} onChange={e => e.target.value && linkTo(Number(e.target.value))} aria-label="Relier à un problème" className="w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1 text-xs">
          <option value="">Relier à un problème…</option>{all.filter(p => !list.some(x => x.id === p.id) && p.status !== 'closed').map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      )}
    </div>
  );
}
