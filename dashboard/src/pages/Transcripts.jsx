import React, { useEffect, useState, useCallback } from 'react';
import { Search, FileText, Download } from 'lucide-react';
import api from '../api';
import Pagination from '../components/Pagination';

function fmtDate(d) {
  return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function Transcripts() {
  const [data, setData] = useState({ snapshots: [], total: 0, pages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page };
      if (search) params.search = search;
      const { data: res } = await api.get('/transcripts', { params });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Transcripts</h1>
        <p className="text-sm text-slate-500 mt-0.5">{data.total} transcript(s) archivé(s)</p>
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Rechercher par utilisateur ou sujet..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-full bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-600 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Ticket</th>
              <th className="text-left px-4 py-3 font-medium">Utilisateur</th>
              <th className="text-left px-4 py-3 font-medium">Sujet</th>
              <th className="text-left px-4 py-3 font-medium">Messages</th>
              <th className="text-left px-4 py-3 font-medium">Généré par</th>
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-600">Chargement...</td></tr>
            ) : !data.snapshots.length ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-600">Aucun transcript</td></tr>
            ) : data.snapshots.map(s => (
              <tr key={s.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30 transition-colors">
                <td className="px-4 py-3 text-slate-500 font-mono">#{s.ticket_id}</td>
                <td className="px-4 py-3 text-slate-200 font-medium">{s.owner_tag}</td>
                <td className="px-4 py-3 text-slate-400 max-w-xs truncate">{s.subject || '—'}</td>
                <td className="px-4 py-3 text-slate-400">{s.message_count}</td>
                <td className="px-4 py-3 text-slate-400">{s.created_by_tag}</td>
                <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(s.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <a
                      href={`/api/transcripts/${s.id}/html`}
                      target="_blank"
                      rel="noreferrer"
                      title="Voir HTML"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-indigo-600/10 transition-colors"
                    >
                      <FileText size={14} />
                    </a>
                    <a
                      href={`/api/transcripts/${s.id}/txt`}
                      title="Télécharger .txt"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-400 hover:bg-emerald-600/10 transition-colors"
                    >
                      <Download size={14} />
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pages={data.pages} onChange={setPage} />
    </div>
  );
}
