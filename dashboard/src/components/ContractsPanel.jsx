import React, { useEffect, useState } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Organisations → Contrats (v7, utils/contracts.js): blocks of hours, numbers of tickets or
// unlimited support, with their dates, SLA objective, alerts and renewal; consumption computed.
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const KIND_LABELS = { hours: 'Forfait d\'heures', tickets: 'Nombre de tickets', unlimited: 'Illimité' };
const STATE_LABELS = { active: 'en cours', upcoming: 'à venir', ended: 'terminé' };
const hours = m => `${Math.round(m / 6) / 10} h`;
export const contractBalance = c => (c.kind === 'unlimited' ? 'Illimité'
  : c.kind === 'hours' ? `${hours(c.remaining)} restantes sur ${hours(c.quota)}` : `${c.remaining} ticket(s) restant(s) sur ${c.quota}`);

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = () => ({ name: '', kind: 'hours', quotaHours: 10, quota: 10, startsOn: today(), endsOn: '', slaPolicyId: null, alertPercent: 80, alertDays: 30, autoRenew: false, notes: '' });

function ContractForm({ initial, policies, onSave, onCancel }) {
  const [c, setC] = useState(initial);
  const set = (k, v) => setC(x => ({ ...x, [k]: v }));
  const body = () => ({ name: c.name, kind: c.kind, quota: c.kind === 'hours' ? Math.round(Number(c.quotaHours) * 60) : c.kind === 'tickets' ? Number(c.quota) : null,
    startsOn: c.startsOn, endsOn: c.endsOn || null, slaPolicyId: c.slaPolicyId || null, alertPercent: Number(c.alertPercent), alertDays: Number(c.alertDays), autoRenew: !!c.autoRenew, notes: c.notes });
  return (
    <div className="rounded-xl border border-overlay/8 p-3 space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <input value={c.name} onChange={e => set('name', e.target.value)} maxLength={100} placeholder="Support Or 2027" aria-label="Nom du contrat" className={INPUT} />
        <select value={c.kind} onChange={e => set('kind', e.target.value)} aria-label="Type de contrat" className={INPUT}>
          {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {c.kind === 'hours' && <input type="number" min={0.5} step={0.5} value={c.quotaHours} onChange={e => set('quotaHours', e.target.value)} aria-label="Heures du forfait" title="Heures" className={INPUT} />}
        {c.kind === 'tickets' && <input type="number" min={1} value={c.quota} onChange={e => set('quota', e.target.value)} aria-label="Nombre de tickets du contrat" title="Tickets" className={INPUT} />}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[11px] text-ink-3">Début<input type="date" value={c.startsOn} onChange={e => set('startsOn', e.target.value)} className={`${INPUT} mt-0.5`} /></label>
        <label className="text-[11px] text-ink-3">Fin (facultative)<input type="date" value={c.endsOn || ''} onChange={e => set('endsOn', e.target.value)} className={`${INPUT} mt-0.5`} /></label>
        <label className="text-[11px] text-ink-3">Objectif SLA du contrat
          <select value={c.slaPolicyId || ''} onChange={e => set('slaPolicyId', e.target.value ? Number(e.target.value) : null)} className={`${INPUT} mt-0.5`}>
            <option value="">Aucun (choix habituel)</option>{policies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 items-end">
        <label className="text-[11px] text-ink-3">Prévenir à (% consommé, 0 : jamais)<input type="number" min={0} max={100} value={c.alertPercent} onChange={e => set('alertPercent', e.target.value)} className={`${INPUT} mt-0.5`} /></label>
        <label className="text-[11px] text-ink-3">Prévenir avant la fin (jours, 0 : jamais)<input type="number" min={0} max={365} value={c.alertDays} onChange={e => set('alertDays', e.target.value)} className={`${INPUT} mt-0.5`} /></label>
        <label className="flex items-center gap-1.5 text-xs text-ink-2 pb-1.5"><input type="checkbox" checked={!!c.autoRenew} onChange={e => set('autoRenew', e.target.checked)} className="accent-primary" />Renouvelé à la fin</label>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => onSave(body())} disabled={!c.name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Enregistrer le contrat</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-ink-3 border border-overlay/8">Annuler</button>
      </div>
    </div>
  );
}

export default function ContractsPanel({ orgId }) {
  const [data, setData] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | contract id
  useEffect(() => {
    api.get(`/organizations/${orgId}/contracts`).then(r => setData(Array.isArray(r.data?.contracts) ? r.data : false)).catch(() => setData(false));
    api.get('/sla-policies').then(r => setPolicies(r.data?.policies || [])).catch(() => {});
  }, [orgId]);
  if (!data) return null;
  const act = async p => { try { const d = (await p).data; if (Array.isArray(d?.contracts)) setData(d); setEditing(null); toast.success('Contrats enregistrés'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-ink-3 inline-flex items-center gap-1"><FileText size={11} aria-hidden="true" />Contrats</p>
      {data.contracts.length === 0 && editing !== 'new' && <p className="text-xs text-ink-4">Aucun contrat.</p>}
      <ul className="space-y-1.5">
        {data.contracts.map(c => (editing === c.id ? (
          <li key={c.id}><ContractForm policies={policies} initial={{ ...c, quotaHours: c.kind === 'hours' ? c.quota / 60 : 10, quota: c.kind === 'tickets' ? c.quota : 10, endsOn: c.endsOn || '' }}
            onSave={b => act(api.put(`/organizations/${orgId}/contracts/${c.id}`, b))} onCancel={() => setEditing(null)} /></li>
        ) : (
          <li key={c.id} className="rounded-xl border border-overlay/6 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setEditing(c.id)} className="font-medium text-ink-1 hover:underline">{c.name}</button>
              <span className="text-ink-4">{`${KIND_LABELS[c.kind]} · ${STATE_LABELS[c.state]} · ${c.startsOn}${c.endsOn ? ` → ${c.endsOn}` : ''}${c.autoRenew ? ' · renouvelé' : ''}`}</span>
              <button type="button" onClick={() => window.confirm(`Supprimer le contrat « ${c.name} » ?`) && act(api.delete(`/organizations/${orgId}/contracts/${c.id}`))} aria-label={`Supprimer le contrat « ${c.name} »`} className="ml-auto text-ink-4 hover:text-red-400"><Trash2 size={12} /></button>
            </div>
            {c.quota !== null && (
              <div className="mt-1.5">
                <p className={`text-[11px] ${c.percent >= 100 ? 'text-red-400' : 'text-ink-3'}`}>{contractBalance(c)}</p>
                <div className="h-1.5 rounded-full bg-overlay/6 overflow-hidden mt-0.5" role="progressbar" aria-label={`Consommation du contrat « ${c.name} »`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, c.percent || 0)}>
                  <div className={`h-full ${c.percent >= 100 ? 'bg-red-500' : c.percent >= c.alertPercent ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, c.percent || 0)}%` }} />
                </div>
              </div>
            )}
          </li>
        )))}
      </ul>
      {editing === 'new'
        ? <ContractForm policies={policies} initial={EMPTY()} onSave={b => act(api.post(`/organizations/${orgId}/contracts`, b))} onCancel={() => setEditing(null)} />
        : <button type="button" onClick={() => setEditing('new')} className="text-[11px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><Plus size={11} /> Nouveau contrat</button>}
    </div>
  );
}
