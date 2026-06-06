import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter } from 'lucide-react';
import api from '../api';
import Badge from '../components/Badge';
import Pagination from '../components/Pagination';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function Tickets() {
  const navigate = useNavigate();
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

  const setFilter = (key, val) => { setFilters(f => ({ ...f, [key]: val })); setPage(1); };

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Tickets</h1>
        <p className="text-sm text-slate-500 mt-0.5">{data.total} ticket(s) trouvé(s)</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Rechercher par sujet..."
            value={filters.subject}
            onChange={e => setFilter('subject', e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-600 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>
        <select
          value={filters.status}
          onChange={e => setFilter('status', e.target.value)}
          className="bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="">Tous statuts</option>
          <option value="open">Ouvert</option>
          <option value="closed">Fermé</option>
        </select>
        <select
          value={filters.priority}
          onChange={e => setFilter('priority', e.target.value)}
          className="bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="">Toutes priorités</option>
          <option value="low">Faible</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">ID</th>
              <th className="text-left px-4 py-3 font-medium">Utilisateur</th>
              <th className="text-left px-4 py-3 font-medium">Sujet</th>
              <th className="text-left px-4 py-3 font-medium">Statut</th>
              <th className="text-left px-4 py-3 font-medium">Priorité</th>
              <th className="text-left px-4 py-3 font-medium">Créé le</th>
              <th className="text-left px-4 py-3 font-medium">Fermé par</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-600">Chargement...</td></tr>
            ) : !data.tickets.length ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-600">Aucun ticket</td></tr>
            ) : data.tickets.map(t => (
              <tr
                key={t.id}
                onClick={() => navigate(`/tickets/${t.id}`)}
                className="border-b border-slate-800/50 hover:bg-slate-800/40 cursor-pointer transition-colors last:border-0"
              >
                <td className="px-4 py-3 text-slate-500 font-mono">#{t.id}</td>
                <td className="px-4 py-3 text-slate-200 font-medium">{t.owner_tag}</td>
                <td className="px-4 py-3 text-slate-400 max-w-xs truncate">{t.subject || <span className="italic text-slate-600">—</span>}</td>
                <td className="px-4 py-3"><Badge label={t.status} variant={t.status} /></td>
                <td className="px-4 py-3"><Badge label={t.priority} variant={t.priority} /></td>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(t.created_at)}</td>
                <td className="px-4 py-3 text-slate-500 truncate max-w-xs">{t.closed_by_tag || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pages={data.pages} onChange={setPage} />
    </div>
  );
}
