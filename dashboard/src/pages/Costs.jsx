import React, { useEffect, useState } from 'react';
import { Coins, Download, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { uiLocale } from '../i18n';

// Coûts (v5.4, utils/costs.js): rates and fixed amount (founders), reports by period
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const toCents = v => Math.round((parseFloat(String(v).replace(',', '.')) || 0) * 100);
const day = d => d.toISOString().slice(0, 10);

function Settings({ staff, teams }) {
  const [s, setS] = useState(null);
  useEffect(() => { api.get('/costs/settings').then(r => setS(r.data)).catch(() => setS(false)); }, []);
  if (!s) return null;
  const amt = c => (c ? (c / 100).toFixed(2) : '');
  const save = async () => {
    try { setS((await api.put('/costs/settings', s)).data); toast.success('Taux enregistrés'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const setRate = (kind, id, v) => setS(x => { const m = { ...x[kind] }; if (v === '') delete m[id]; else m[id] = toCents(v); return { ...x, [kind]: m }; });
  return (
    <section className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-ink-2">Taux et forfait</h2>
      <div className="flex flex-wrap gap-3 text-xs text-ink-2 items-center">
        <label className="inline-flex items-center gap-1.5">Devise<select value={s.currency} onChange={e => setS({ ...s, currency: e.target.value })} className={INPUT}>{['EUR', 'USD', 'GBP', 'CHF', 'CAD'].map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="inline-flex items-center gap-1.5">Taux horaire de l'espace<input inputMode="decimal" defaultValue={amt(s.defaultRateCents)} onBlur={e => setS({ ...s, defaultRateCents: toCents(e.target.value) })} className={`${INPUT} w-24`} /></label>
        <label className="inline-flex items-center gap-1.5">Forfait par ticket<input inputMode="decimal" defaultValue={amt(s.fixedCents)} onBlur={e => setS({ ...s, fixedCents: toCents(e.target.value) })} className={`${INPUT} w-24`} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><p className="text-[11px] font-semibold text-ink-3">Par équipe (avant celui de l'espace)</p>
          {teams.map(t => <label key={t.id} className="flex items-center gap-2 text-xs text-ink-2"><span className="flex-1">{t.name}</span><input inputMode="decimal" defaultValue={amt(s.teamRates[String(t.id)])} onBlur={e => setRate('teamRates', String(t.id), e.target.value)} aria-label={`Taux horaire : ${t.name}`} className={`${INPUT} w-24`} /></label>)}</div>
        <div className="space-y-1"><p className="text-[11px] font-semibold text-ink-3">Par personne (avant celui de l'équipe)</p>
          {staff.map(p => <label key={p.user_id} className="flex items-center gap-2 text-xs text-ink-2"><span className="flex-1">{p.username}</span><input inputMode="decimal" defaultValue={amt(s.userRates[p.user_id])} onBlur={e => setRate('userRates', p.user_id, e.target.value)} aria-label={`Taux horaire : ${p.username}`} className={`${INPUT} w-24`} /></label>)}</div>
      </div>
      <button type="button" onClick={save} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white">Enregistrer les taux</button>
    </section>
  );
}

export default function Costs() {
  const { user } = useAuth();
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(() => day(new Date(Date.now() + 864e5)));
  const [by, setBy] = useState('organization');
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  useEffect(() => {
    api.get('/tickets/staff').then(r => setStaff(r.data || [])).catch(() => {});
    api.get('/teams').then(r => setTeams(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);
  useEffect(() => {
    setData(null);
    api.get('/costs/report', { params: { from, to, by } }).then(r => setData(r.data)).catch(err => { setData(false); toast.error(err.response?.data?.error || 'Erreur'); });
  }, [from, to, by]);
  const money = (c, cur) => new Intl.NumberFormat(uiLocale(), { style: 'currency', currency: cur || 'EUR' }).format((c || 0) / 100);
  const hours = s => `${(s / 3600).toLocaleString(uiLocale(), { maximumFractionDigits: 1 })} h`;
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><Coins size={20} className="text-primary-light" /> Coûts</h1>
        <p className="text-sm text-ink-3 mt-1">Le temps passé au taux de la personne (sinon de l'équipe du ticket, sinon de l'espace), un forfait par ticket ouvert, et les frais ajoutés aux tickets. Pour refacturer un client ou un service.</p>
      </div>
      {user?.role === 'fondateur' && <Settings staff={staff} teams={teams} />}
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <label className="inline-flex items-center gap-1.5">Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={INPUT} /></label>
        <label className="inline-flex items-center gap-1.5">au<input type="date" value={to} onChange={e => setTo(e.target.value)} className={INPUT} /></label>
        <select value={by} onChange={e => setBy(e.target.value)} aria-label="Regrouper par" className={INPUT}>
          <option value="organization">Par organisation</option><option value="ticket">Par ticket</option><option value="user">Par personne</option><option value="team">Par équipe</option>
        </select>
        <a href={`/api/costs/report?from=${from}&to=${to}&by=${by}&format=csv`} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-overlay/8 text-ink-2 hover:text-ink-1"><Download size={12} /> CSV</a>
      </div>
      {data === null ? <Loader2 size={16} className="animate-spin text-ink-4" /> : data && (
        <div className="bg-surface-card border border-overlay/6 rounded-2xl overflow-x-auto" tabIndex={0} role="region" aria-label="Rapport des coûts">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-ink-4 border-b border-overlay/6">
              <th className="px-3 py-2 font-medium">Groupe</th><th className="px-3 py-2 font-medium">Tickets</th><th className="px-3 py-2 font-medium">Temps</th>
              <th className="px-3 py-2 font-medium">Coût du temps</th><th className="px-3 py-2 font-medium">Forfaits</th><th className="px-3 py-2 font-medium">Frais</th><th className="px-3 py-2 font-medium">Total</th></tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-4">Rien sur cette période.</td></tr>}
              {data.rows.map(r => (
                <tr key={r.key || r.label} className="border-b border-overlay/4 last:border-0">
                  <td className="px-3 py-2 text-ink-1">{r.label}</td><td className="px-3 py-2 text-ink-2 tabular-nums">{r.tickets}</td><td className="px-3 py-2 text-ink-2 tabular-nums">{hours(r.seconds)}</td>
                  <td className="px-3 py-2 tabular-nums">{money(r.timeCents, data.currency)}</td><td className="px-3 py-2 tabular-nums">{money(r.fixedCents, data.currency)}</td>
                  <td className="px-3 py-2 tabular-nums">{money(r.extraCents, data.currency)}</td><td className="px-3 py-2 font-semibold text-ink-1 tabular-nums">{money(r.totalCents, data.currency)}</td>
                </tr>
              ))}
            </tbody>
            {data.rows.length > 0 && <tfoot><tr><td colSpan={6} className="px-3 py-2 text-right text-ink-3">Total</td><td className="px-3 py-2 font-bold text-ink-1 tabular-nums">{money(data.totalCents, data.currency)}</td></tr></tfoot>}
          </table>
        </div>
      )}
    </div>
  );
}
