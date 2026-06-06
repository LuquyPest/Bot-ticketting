import React, { useEffect, useState } from 'react';
import { Star, Clock, Ticket } from 'lucide-react';
import api from '../api';

function fmtDuration(s) {
  if (!s) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${(s / 3600).toFixed(1)}h`;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function StarRating({ value }) {
  if (!value) return <span className="text-slate-600">—</span>;
  const num = parseFloat(value);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {[1,2,3,4,5].map(i => (
          <Star key={i} size={12} fill={i <= Math.round(num) ? '#f59e0b' : 'none'} className={i <= Math.round(num) ? 'text-amber-400' : 'text-slate-700'} />
        ))}
      </div>
      <span className="text-sm text-slate-300">{num.toFixed(1)}</span>
    </div>
  );
}

export default function Staff() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('tickets_closed');

  useEffect(() => {
    api.get('/staff')
      .then(r => setStaff(r.data))
      .finally(() => setLoading(false));
  }, []);

  const sorted = [...staff].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Staff</h1>
          <p className="text-sm text-slate-500 mt-0.5">{staff.length} membre(s) actif(s)</p>
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="tickets_closed">Trier par fermetures</option>
          <option value="tickets_claimed">Trier par claims</option>
          <option value="avgRating">Trier par note</option>
        </select>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">#</th>
              <th className="text-left px-4 py-3 font-medium">Membre</th>
              <th className="text-left px-4 py-3 font-medium">Fermetures</th>
              <th className="text-left px-4 py-3 font-medium">Claims</th>
              <th className="text-left px-4 py-3 font-medium">Tps réponse moy.</th>
              <th className="text-left px-4 py-3 font-medium">Note moy.</th>
              <th className="text-left px-4 py-3 font-medium">Dernière activité</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-600">Chargement...</td></tr>
            ) : !sorted.length ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-600">Aucune statistique</td></tr>
            ) : sorted.map((s, i) => (
              <tr key={s.admin_id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30 transition-colors">
                <td className="px-4 py-3 text-slate-600 font-mono text-xs">{i + 1}</td>
                <td className="px-4 py-3">
                  <div>
                    <p className="text-slate-200 font-medium">{s.admin_tag}</p>
                    <p className="text-xs text-slate-600 font-mono">{s.admin_id}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <Ticket size={13} className="text-emerald-500" />
                    <span className="text-slate-200 font-semibold">{s.tickets_closed}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">{s.tickets_claimed}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <Clock size={13} className="text-amber-500" />
                    <span className="text-slate-300">{fmtDuration(s.avgResponseSeconds)}</span>
                  </div>
                </td>
                <td className="px-4 py-3"><StarRating value={s.avgRating} /></td>
                <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(s.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
