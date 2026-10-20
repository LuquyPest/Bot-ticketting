import React, { useCallback, useEffect, useState } from 'react';
import { uiLocale } from '../../i18n';
import { Loader2, RefreshCw } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';

const LABELS = {
  guild_approve: 'Serveur approuvé', guild_suspend: 'Serveur suspendu', guild_reactivate: 'Serveur réactivé',
  guild_delete: 'Serveur supprimé', guild_maintenance: 'Maintenance', guild_limits: 'Limites modifiées', guild_plan: 'Formule attribuée',
  founder_add: 'Fondateur nommé', founder_remove: 'Fondateur retiré', account_unlock: 'Compte débloqué', ip_unblock: 'IP débloquée',
  manager_create: 'Manager créé', manager_update: 'Manager modifié', manager_reset_totp: '2FA d\'un manager réinitialisée', manager_delete: 'Manager supprimé',
  error_delete: 'Erreur supprimée', errors_clear: 'Journal d\'erreurs vidé', error_alert_update: 'Alerte d\'erreurs modifiée', error_alert_test: 'Test de l\'alerte',
  plan_create: 'Formule créée', plan_update: 'Formule modifiée', plan_delete: 'Formule supprimée',
};
const fmt = d => new Date(d).toLocaleString(uiLocale(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const detailsText = d => {
  if (!d) return '';
  const obj = typeof d === 'string' ? JSON.parse(d) : d;
  return Object.entries(obj).map(([k, v]) => `${k} : ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
};

export default function SAJournal() {
  const [filters, setFilters] = useState({ actor: '', action: '', guild_id: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    const params = { page, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
    api.get('/sa/audit', { params }).then(r => setData(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, [filters, page]);
  useEffect(() => { load(); }, [load]);
  const set = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1); };
  const input = 'px-3 py-2 rounded-xl bg-overlay/4 border border-overlay/8 text-xs text-ink-1 outline-hidden focus:border-primary/50';

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink-1">Journal du panel</h1>
          <p className="text-sm text-ink-3">Toutes les modifications faites par les super-admins et managers, avec le serveur concerné</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/5" title="Actualiser"><RefreshCw size={15} /></button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={filters.actor} onChange={e => set('actor', e.target.value)} className={input} aria-label="Compte">
          <option value="">Tous les comptes</option>
          {(data?.actors || []).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filters.action} onChange={e => set('action', e.target.value)} className={input} aria-label="Action">
          <option value="">Toutes les actions</option>
          {Object.entries(LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input value={filters.guild_id} onChange={e => set('guild_id', e.target.value.trim())} placeholder="ID du serveur" className={`${input} font-mono`} />
      </div>

      <div className="glass-dark rounded-2xl border border-overlay/8 overflow-hidden">
        {!data ? (
          <div className="flex justify-center py-12"><Loader2 size={18} className="animate-spin text-ink-3" /></div>
        ) : data.rows.length === 0 ? (
          <p className="py-12 text-center text-xs text-ink-4">Aucune action enregistrée</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-ink-4 border-b border-overlay/6">
                  {['Date', 'Compte', 'Action', 'Serveur', 'Détails', 'IP'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-overlay/4">
                {data.rows.map(r => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2.5 text-ink-3 whitespace-nowrap tabular-nums">{fmt(r.created_at)}</td>
                    <td className="px-4 py-2.5 text-ink-1 whitespace-nowrap">{r.actor_name} <span className="text-[10px] text-ink-4">{r.actor_type === 'superadmin' ? 'SA' : 'manager'}</span></td>
                    <td className="px-4 py-2.5 text-ink-2 whitespace-nowrap">{LABELS[r.action] || r.action}</td>
                    <td className="px-4 py-2.5 text-ink-2">{r.guild_id ? (r.guild_name || <span className="font-mono">{r.guild_id}</span>) : '—'}</td>
                    <td className="px-4 py-2.5 text-ink-3 max-w-md break-words">{detailsText(r.details)}</td>
                    <td className="px-4 py-2.5 text-ink-4 font-mono">{r.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.pages > 1 && (
          <div className="px-4 py-3 border-t border-overlay/6 flex items-center justify-between text-xs text-ink-3">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg hover:bg-overlay/5 disabled:opacity-40">Précédent</button>
            <span>Page {data.page} / {data.pages}</span>
            <button disabled={page >= data.pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg hover:bg-overlay/5 disabled:opacity-40">Suivant</button>
          </div>
        )}
      </div>
    </div>
  );
}
