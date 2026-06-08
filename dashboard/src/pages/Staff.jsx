import React, { useEffect, useState } from 'react';
import { Star, Clock, Ticket, Users, AlertCircle } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { fmtDate, fmtDuration } from '../utils/format';

function StarRating({ value }) {
  if (!value) return <span className="text-ink-4">—</span>;
  const num = parseFloat(value);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {[1,2,3,4,5].map(i => (
          <Star key={i} size={11} fill={i <= Math.round(num) ? '#f59e0b' : 'none'} className={i <= Math.round(num) ? 'text-amber-400' : 'text-ink-4'} />
        ))}
      </div>
      <span className="text-xs text-ink-2 font-medium">{num.toFixed(1)}</span>
    </div>
  );
}

export default function Staff() {
  const { user } = useAuth();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('tickets_closed');
  const isSupport = user?.role === 'support';

  useEffect(() => {
    api.get('/staff')
      .then(r => setStaff(r.data))
      .catch(err => {
        const msg = err.response?.data?.error || 'Erreur de chargement';
        setError(msg);
        toast.error(msg);
      })
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
        <div className="page-header">
          <h1>Staff</h1>
          <p>{staff.length} membre(s) actif(s)</p>
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)}
          className="bg-surface border border-white/[0.07] text-ink-2 rounded-xl px-3 py-1.5 text-xs
                     focus:outline-none focus:border-primary/50 transition-all hover:border-white/[0.12]">
          <option value="tickets_closed">Trier par fermetures</option>
          <option value="tickets_claimed">Trier par claims</option>
          <option value="avgRating">Trier par note</option>
          <option value="avgResponseSeconds">Trier par temps de réponse</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">#</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Membre</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Fermetures</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Claims</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Tps réponse moy.</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Note moy.</th>
              <th className="text-left px-4 py-3.5 text-[10px] font-semibold text-ink-4 uppercase tracking-wider">Activité</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-ink-4 text-sm">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
                    Chargement...
                  </div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={7}>
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                      <AlertCircle size={20} className="text-red-400" />
                    </div>
                    <p className="text-sm text-red-400 font-medium">{error}</p>
                  </div>
                </td>
              </tr>
            ) : !sorted.length ? (
              <tr>
                <td colSpan={7}>
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-surface border border-white/[0.06] flex items-center justify-center">
                      <Users size={20} className="text-ink-4" />
                    </div>
                    <p className="text-sm text-ink-3 font-medium">
                      {isSupport ? 'Aucune statistique pour ton compte' : 'Aucune statistique disponible'}
                    </p>
                    {isSupport && (
                      <p className="text-xs text-ink-4 text-center max-w-xs">
                        Les stats se mettent à jour quand tu claim ou fermes des tickets (via Discord ou le dashboard).
                      </p>
                    )}
                  </div>
                </td>
              </tr>
            ) : sorted.map((s, i) => (
              <tr key={s.admin_id}
                className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.025] transition-colors">
                <td className="px-4 py-3.5 text-ink-4 font-mono text-xs tabular-nums">{i + 1}</td>
                <td className="px-4 py-3.5">
                  <div>
                    <p className="text-ink-1 font-semibold text-sm">{s.admin_tag}</p>
                    <p className="text-[10px] text-ink-4 font-mono mt-0.5">{s.admin_id}</p>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-1.5">
                    <Ticket size={12} className="text-emerald-400" />
                    <span className="text-ink-1 font-semibold text-sm tabular-nums">{s.tickets_closed}</span>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-ink-2 text-sm tabular-nums">{s.tickets_claimed}</td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-1.5">
                    <Clock size={12} className="text-amber-400" />
                    <span className="text-ink-2 text-sm">{fmtDuration(s.avgResponseSeconds)}</span>
                  </div>
                </td>
                <td className="px-4 py-3.5"><StarRating value={s.avgRating} /></td>
                <td className="px-4 py-3.5 text-ink-4 text-xs tabular-nums">
                  {fmtDate(s.updated_at, { day: '2-digit', month: '2-digit', year: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
