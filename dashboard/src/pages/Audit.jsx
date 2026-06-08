import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ScrollText, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { fmtDate } from '../utils/format';

const ACTION_LABELS = {
  grade_create:             'Grade créé',
  grade_update:             'Grade modifié',
  grade_delete:             'Grade supprimé',
  grade_permissions_update: 'Permissions grade mises à jour',
  grade_assign:             'Grade attribué',
  grade_remove:             'Grade retiré',
  user_role_change:         'Rôle utilisateur modifié',
  ticket_visibility_change: 'Visibilité ticket modifiée'
};

const ACTION_COLORS = {
  grade_create:             'bg-emerald-600/15 text-emerald-400 border-emerald-600/30',
  grade_update:             'bg-blue-600/15 text-blue-400 border-blue-600/30',
  grade_delete:             'bg-red-600/15 text-red-400 border-red-600/30',
  grade_permissions_update: 'bg-primary/15 text-primary-light border-primary/30',
  grade_assign:             'bg-violet-600/15 text-violet-400 border-violet-600/30',
  grade_remove:             'bg-orange-600/15 text-orange-400 border-orange-600/30',
  user_role_change:         'bg-amber-600/15 text-amber-400 border-amber-600/30',
  ticket_visibility_change: 'bg-sky-600/15 text-sky-400 border-sky-600/30'
};

function formatDetails(row) {
  if (!row.details) return null;
  try {
    const d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
    return Object.entries(d)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join(' · ');
  } catch {
    return String(row.details);
  }
}

export default function Audit() {
  const [data, setData] = useState({ rows: [], total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterAction, setFilterAction] = useState('');
  const [filterActor, setFilterActor] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = { page };
    if (filterAction) params.action = filterAction;
    if (filterActor) params.actor = filterActor;
    api.get('/audit', { params })
      .then(r => setData(r.data))
      .catch(() => toast.error('Erreur chargement'))
      .finally(() => setLoading(false));
  }, [page, filterAction, filterActor]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Journal d'audit</h1>
          <p className="text-sm text-ink-3 mt-0.5">{data.total} entrée{data.total !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface transition-colors">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <select
          value={filterAction}
          onChange={e => { setFilterAction(e.target.value); setPage(1); }}
          className="bg-surface border border-white/[0.08] text-ink-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
        >
          <option value="">Toutes les actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          value={filterActor}
          onChange={e => { setFilterActor(e.target.value); setPage(1); }}
          placeholder="Filtrer par auteur..."
          className="bg-surface border border-white/[0.08] text-ink-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary w-48"
        />
      </div>

      <div className="bg-surface-card border border-white/[0.06] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-xs text-ink-3 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Auteur</th>
              <th className="text-left px-4 py-3 font-medium">Action</th>
              <th className="text-left px-4 py-3 font-medium">Cible</th>
              <th className="text-left px-4 py-3 font-medium">Détails</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-10 text-ink-4">Chargement...</td></tr>
            ) : !data.rows.length ? (
              <tr><td colSpan={5} className="text-center py-10 text-ink-4">Aucune entrée</td></tr>
            ) : data.rows.map(row => (
              <tr key={row.id} className="border-b border-white/[0.06]/50 last:border-0 hover:bg-surface/20 transition-colors">
                <td className="px-4 py-3 text-xs text-ink-3 whitespace-nowrap">{fmtDate(row.created_at)}</td>
                <td className="px-4 py-3">
                  <p className="text-xs text-ink-2 font-medium">{row.actor_tag}</p>
                  <p className="text-[10px] text-ink-4 font-mono">{row.actor_id}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${ACTION_COLORS[row.action] || 'bg-surface-hover text-ink-2 border-white/[0.1]'}`}>
                    {ACTION_LABELS[row.action] || row.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-ink-3">
                  {row.target_type && <span className="text-ink-4">{row.target_type}/</span>}
                  {row.target_id}
                </td>
                <td className="px-4 py-3 text-xs text-ink-4 max-w-xs truncate" title={formatDetails(row)}>
                  {formatDetails(row)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-4">Page {data.page} / {data.pages}</p>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="p-1.5 rounded-lg text-ink-3 hover:text-ink-2 hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              disabled={page >= data.pages}
              onClick={() => setPage(p => p + 1)}
              className="p-1.5 rounded-lg text-ink-3 hover:text-ink-2 hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
