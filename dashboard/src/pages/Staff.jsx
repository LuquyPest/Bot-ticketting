import React, { useEffect, useState } from 'react';
import { Star, Clock, Ticket, Users } from 'lucide-react';
import api from '../api';
import { fmtDate, fmtDuration } from '../utils/format';

function StarRating({ value }) {
  if (!value) return <span className="text-slate-700">—</span>;
  const num = parseFloat(value);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {[1,2,3,4,5].map(i => (
          <Star key={i} size={11} fill={i <= Math.round(num) ? '#f59e0b' : 'none'} className={i <= Math.round(num) ? 'text-amber-400' : 'text-slate-700'} />
        ))}
      </div>
      <span className="text-xs text-slate-400 font-medium">{num.toFixed(1)}</span>
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

  const sorted = [...staff].sort((a, b) => {
    if (sort === 'avgResponseSeconds') {
      const aVal = a.avgResponseSeconds ?? Infinity;
      const bVal = b.avgResponseSeconds ?? Infinity;
      return aVal - bVal;
    }
    return (b[sort] ?? 0) - (a[sort] ?? 0);
  });

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Staff</h1>
          <p className="text-sm text-slate-500 mt-0.5">{staff.length} membre(s) actif(s)</p>
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="bg-slate-800/50 border border-slate-700/60 text-slate-400 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500/60 transition-colors"
        >
          <option value="tickets_closed">Trier par fermetures</option>
          <option value="tickets_claimed">Trier par claims</option>
          <option value="avgRating">Trier par note</option>
          <option value="avgResponseSeconds">Trier par temps de réponse</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800/60 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800/60">
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">#</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Membre</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Fermetures</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Claims</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Tps réponse moy.</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Note moy.</th>
              <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Dernière activité</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-600 text-sm">Chargement...</td></tr>
            ) : !sorted.length ? (
              <tr>
                <td colSpan={7}>
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
                      <Users size={22} className="text-slate-600" />
                    </div>
                    <p className="text-sm text-slate-600 font-medium">Aucune statistique disponible</p>
                  </div>
                </td>
              </tr>
            ) : sorted.map((s, i) => (
              <tr key={s.admin_id} className="border-b border-slate-800/40 last:border-0 hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-3 text-slate-700 font-mono text-xs">{i + 1}</td>
                <td className="px-4 py-3">
                  <div>
                    <p className="text-slate-200 font-medium text-sm">{s.admin_tag}</p>
                    <p className="text-[10px] text-slate-600 font-mono mt-0.5">{s.admin_id}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <Ticket size={12} className="text-emerald-500" />
                    <span className="text-slate-200 font-semibold text-sm">{s.tickets_closed}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400 text-sm">{s.tickets_claimed}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <Clock size={12} className="text-amber-500" />
                    <span className="text-slate-400 text-sm">{fmtDuration(s.avgResponseSeconds)}</span>
                  </div>
                </td>
                <td className="px-4 py-3"><StarRating value={s.avgRating} /></td>
                <td className="px-4 py-3 text-slate-600 text-xs">{fmtDate(s.updated_at, { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
