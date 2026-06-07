import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Download, Inbox } from 'lucide-react';
import api from '../api';
import Badge from '../components/Badge';
import Pagination from '../components/Pagination';
import { fmtDate } from '../utils/format';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useAuth } from '../App';

const PRIORITY_DOT = {
  low:    'bg-sky-400',
  normal: 'bg-amber-400',
  urgent: 'bg-red-400'
};

const PRIORITY_LABELS = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };

export default function Tickets() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState({ tickets: [], total: 0, pages: 1 });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: '', priority: '', subject: '' });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
      const { data: res } = await api.get('/tickets', { params });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load);

  const setFilter = (key, val) => { setFilters(f => ({ ...f, [key]: val })); setPage(1); };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Tickets</h1>
          <p className="text-sm text-slate-500 mt-0.5">{data.total} ticket(s) trouvé(s)</p>
        </div>
        {user?.role === 'fondateur' && (
          <a
            href="/api/tickets/export"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700/60 text-slate-400 hover:text-slate-100 hover:bg-slate-700 text-xs font-medium transition-colors"
          >
            <Download size={13} /> Export CSV
          </a>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            placeholder="Rechercher par sujet..."
            value={filters.subject}
            onChange={e => setFilter('subject', e.target.value)}
            className="w-full bg-slate-800/50 border border-slate-700/60 text-slate-300 placeholder-slate-600 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500/60 transition-colors"
          />
        </div>
        <select
          value={filters.status}
          onChange={e => setFilter('status', e.target.value)}
          className="bg-slate-800/50 border border-slate-700/60 text-slate-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500/60 transition-colors"
        >
          <option value="">Tous statuts</option>
          <option value="open">Ouvert</option>
          <option value="closed">Fermé</option>
        </select>
        <select
          value={filters.priority}
          onChange={e => setFilter('priority', e.target.value)}
          className="bg-slate-800/50 border border-slate-700/60 text-slate-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500/60 transition-colors"
        >
          <option value="">Toutes priorités</option>
          <option value="low">Faible</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800/60 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800/60">
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">ID</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Utilisateur</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Sujet</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Statut</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Priorité</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Créé le</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Fermé par</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-slate-600 text-sm">Chargement...</td>
              </tr>
            ) : !data.tickets.length ? (
              <tr>
                <td colSpan={7}>
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
                      <Inbox size={22} className="text-slate-600" />
                    </div>
                    <p className="text-sm text-slate-600 font-medium">Aucun ticket trouvé</p>
                    <p className="text-xs text-slate-700">Modifiez vos filtres ou attendez de nouveaux tickets.</p>
                  </div>
                </td>
              </tr>
            ) : data.tickets.map(t => (
              <tr
                key={t.id}
                onClick={() => navigate(`/tickets/${t.id}`)}
                className={`border-b border-slate-800/40 hover:bg-slate-800/60 cursor-pointer transition-colors last:border-0 ${
                  t.priority === 'urgent' ? 'border-l-2 border-l-red-500/50' : ''
                }`}
              >
                <td className="px-4 py-3 text-slate-600 font-mono text-xs">#{t.id}</td>
                <td className="px-4 py-3 text-slate-200 font-medium">{t.owner_tag}</td>
                <td className="px-4 py-3 text-slate-400 max-w-xs truncate">
                  {t.subject || <span className="italic text-slate-700">—</span>}
                </td>
                <td className="px-4 py-3">
                  <Badge label={t.status} variant={t.status} />
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || 'bg-slate-600'}`} />
                    {PRIORITY_LABELS[t.priority] || t.priority}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                  {fmtDate(t.created_at, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-xs">{t.closed_by_tag || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pages={data.pages} onChange={setPage} />
    </div>
  );
}
