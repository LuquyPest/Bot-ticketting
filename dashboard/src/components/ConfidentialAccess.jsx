import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../api';
import { fmtDate } from '../utils/format';

const ACCESS_KIND = { view: 'Fiche ouverte', notes: 'Messages lus', transcript: 'Transcript lu', pdf: 'PDF téléchargé', guest: 'Lien invité' };

// Who opened which confidential ticket, and when (founders only). ticketId: one ticket only.
export default function ConfidentialAccess({ ticketId = null }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  useEffect(() => {
    const req = ticketId ? api.get(`/tickets/${ticketId}/access-log`).then(r => ({ rows: r.data, pages: 1, page: 1, total: r.data.length }))
      : api.get('/audit/confidential-access', { params: { page } }).then(r => r.data);
    req.then(setData).catch(() => setData({ rows: [], pages: 1, page: 1, total: 0 }));
  }, [ticketId, page]);

  if (!data) return <p className="text-xs text-ink-4">Chargement…</p>;
  if (!data.rows.length) return <p className="text-xs text-ink-4">Aucune consultation enregistrée.</p>;
  if (ticketId) {
    return (
      <ul className="space-y-1.5 text-[11px]">
        {data.rows.slice(0, 30).map((r, i) => (
          <li key={i} className="flex flex-wrap gap-x-1.5"><span className="text-ink-1 font-medium" translate="no">{r.user_tag}</span>
            <span className="text-ink-3">{ACCESS_KIND[r.kind] || r.kind}</span><span className="text-ink-4 ml-auto tabular-nums">{fmtDate(r.created_at)}</span></li>
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3">Chaque ouverture d'un ticket confidentiel (fiche, messages, transcript, PDF, lien invité) par personne, au plus une fois toutes les 10 minutes par type. {data.total} consultation(s).</p>
      <div className="bg-overlay/2 rounded-2xl border border-overlay/6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-overlay/6 text-[10px] uppercase tracking-wider text-ink-4">
            <th className="text-left px-4 py-3 font-semibold">Date</th><th className="text-left px-4 py-3 font-semibold">Qui</th>
            <th className="text-left px-4 py-3 font-semibold">Ticket</th><th className="text-left px-4 py-3 font-semibold">Consultation</th><th className="text-left px-4 py-3 font-semibold">IP</th>
          </tr></thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.id} className="border-b border-overlay/4 last:border-0">
                <td className="px-4 py-2.5 text-xs text-ink-3 tabular-nums whitespace-nowrap">{fmtDate(r.created_at)}</td>
                <td className="px-4 py-2.5 text-ink-1" translate="no">{r.user_tag}</td>
                <td className="px-4 py-2.5"><Link to={`/tickets/${r.ticket_id}`} className="text-primary-light hover:underline">#{r.ticket_id}</Link></td>
                <td className="px-4 py-2.5 text-ink-2">{ACCESS_KIND[r.kind] || r.kind}</td>
                <td className="px-4 py-2.5 text-xs text-ink-4 font-mono" translate="no">{r.ip || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-xs text-ink-3">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Page précédente" className="p-1.5 rounded-lg hover:bg-overlay/5 disabled:opacity-40"><ChevronLeft size={14} /></button>
          Page {data.page} / {data.pages}
          <button disabled={page >= data.pages} onClick={() => setPage(p => p + 1)} aria-label="Page suivante" className="p-1.5 rounded-lg hover:bg-overlay/5 disabled:opacity-40"><ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  );
}
