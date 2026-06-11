import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Clock, RefreshCw, Filter } from 'lucide-react';
import api from '../api';

const STATUS_CONFIG = {
  success:      { label: 'Succès',       cls: 'bg-emerald-500/15 text-emerald-300' },
  '2fa_required': { label: '2FA requis', cls: 'bg-amber-500/15 text-amber-300' },
  blocked:      { label: 'Bloqué',       cls: 'bg-red-500/15 text-red-400' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, cls: 'bg-white/10 text-ink-3' };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function fmt(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export default function LoginLogs() {
  const [logs, setLogs]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit]     = useState(50);
  const [filter, setFilter]   = useState('all'); // all | success | 2fa_required | blocked

  const load = () => {
    setLoading(true);
    api.get(`/login-logs?limit=${limit}`)
      .then(r => setLogs(r.data.logs))
      .finally(() => setLoading(false));
  };

  useEffect(load, [limit]);

  const filtered = logs ? (filter === 'all' ? logs : logs.filter(l => l.status === filter)) : [];

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Logs de connexion</h1>
          <p className="text-sm text-ink-3 mt-0.5">Historique des connexions au dashboard</p>
        </div>
        <button onClick={load} className="p-2 text-ink-3 hover:text-ink-1 hover:bg-surface rounded-lg transition-colors">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={13} className="text-ink-4" />
        {[['all', 'Tous'], ['success', 'Succès'], ['2fa_required', '2FA requis'], ['blocked', 'Bloqués']].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-all ${
              filter === val
                ? 'bg-primary text-white'
                : 'bg-surface-card border border-white/[0.06] text-ink-3 hover:text-ink-1'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-ink-4">Afficher</span>
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="bg-surface border border-white/[0.08] text-ink-2 rounded-lg px-2 py-1
                       text-xs focus:outline-none focus:border-primary transition-colors"
          >
            {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-xs text-ink-4">entrées</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="text-sm text-ink-3 text-center py-10">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-ink-4 text-center py-10">Aucun log trouvé</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.04] text-[11px] text-ink-4 uppercase tracking-wider">
                  <th className="text-left px-5 py-3 font-medium">Utilisateur</th>
                  <th className="text-left px-4 py-3 font-medium">Statut</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">IP</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Navigateur</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {filtered.map((log, i) => (
                  <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {log.status === 'blocked'
                          ? <ShieldAlert size={13} className="text-red-400 shrink-0" />
                          : <ShieldCheck size={13} className="text-emerald-400/60 shrink-0" />
                        }
                        <div>
                          <p className="font-medium text-ink-1">{log.username || '—'}</p>
                          <p className="text-[10px] text-ink-4 font-mono">{log.user_id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="font-mono text-xs text-ink-3">{log.ip_address || '—'}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-ink-3 truncate max-w-[200px] block" title={log.user_agent}>
                        {log.user_agent ? parseUa(log.user_agent) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs text-ink-3">
                        <Clock size={11} className="text-ink-4" />
                        {fmt(log.created_at)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && logs && (
        <p className="text-xs text-ink-4 text-right">
          {filtered.length} entrée{filtered.length !== 1 ? 's' : ''} affichée{filtered.length !== 1 ? 's' : ''}
          {filter !== 'all' ? ` (filtre : ${filter})` : ''}
        </p>
      )}
    </div>
  );
}

function parseUa(ua) {
  if (!ua) return '—';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/') && !ua.includes('Chromium/')) return 'Chrome';
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
  if (ua.includes('OPR/') || ua.includes('Opera/')) return 'Opera';
  return ua.slice(0, 40);
}
