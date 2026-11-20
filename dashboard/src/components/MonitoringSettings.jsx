import React, { useEffect, useState } from 'react';
import { Activity, Plus, Trash2 } from 'lucide-react';
import api from '../api';
import TestButton from './TestButton';
import toast from 'react-hot-toast';

// Paramètres → Intégrations → Supervision (v7, utils/monitoringAlerts.js)
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const PRIO = { low: 'Basse', normal: 'Normale', urgent: 'Urgente' };

export default function MonitoringSettings() {
  const [d, setD] = useState(null);
  const [teams, setTeams] = useState([]);
  const [f, setF] = useState({ name: '', kind: 'alertmanager', priority: 'urgent', teamId: '', subject: '', autoClose: true });
  useEffect(() => {
    api.get('/monitoring-sources').then(r => setD(Array.isArray(r.data?.sources) ? r.data : false)).catch(() => setD(false));
    api.get('/teams').then(r => setTeams(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);
  if (!d) return null;
  const act = async (p, ok) => { try { const r = await p; if (Array.isArray(r.data?.sources)) setD(r.data); if (ok) toast.success(ok); return true; } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; } };
  const copy = v => navigator.clipboard?.writeText(v).then(() => toast.success('Copié')).catch(() => {});
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-ink-3 inline-flex items-center gap-1.5"><Activity size={13} aria-hidden="true" />Une alerte qui se déclenche ouvre un ticket (ou complète celui de la même alerte) ; sa fin le résout. Chaque source a son adresse secrète, à coller comme webhook dans l'outil.</p>
      <ul className="space-y-1.5">
        {d.sources.map(s => (
          <li key={s.id} className="rounded-xl border border-overlay/8 p-2.5 text-xs space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink-1">{s.name}</span><span className="text-ink-4">{`${d.kinds[s.kind]} · ${PRIO[s.priority]}${s.autoClose ? ' · fermé à la fin de l\'alerte' : ''}${s.active ? '' : ' · coupée'}`}</span>
              <button type="button" onClick={() => act(api.put(`/monitoring-sources/${s.id}`, { ...s, active: !s.active }))} className="ml-auto text-ink-3 hover:text-ink-1 underline">{s.active ? 'Couper' : 'Activer'}</button>
              <button type="button" onClick={() => window.confirm(`Supprimer la source « ${s.name} » ?`) && act(api.delete(`/monitoring-sources/${s.id}`))} aria-label={`Supprimer la source « ${s.name} »`} className="text-ink-4 hover:text-red-400"><Trash2 size={12} /></button>
            </div>
            <p className="flex flex-wrap items-center gap-2 text-ink-3 break-all"><code className="px-1 rounded bg-overlay/6" translate="no">{s.url}</code><button type="button" onClick={() => copy(s.url)} className="underline hover:text-ink-1">Copier</button>
              <button type="button" onClick={() => act(api.put(`/monitoring-sources/${s.id}`, { ...s, newSecret: true }), 'Nouvelle adresse')} className="underline hover:text-ink-1">Nouvelle adresse</button></p>
            <TestButton url={`/monitoring-sources/${s.id}/test`} label="Envoyer une alerte de test" describe={d => `Ticket #${d.ticketId} ouvert${d.closed ? ' puis fermé à la fin de l\'alerte' : ', une note marque la fin de l\'alerte'}.`} />
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-3">
        <input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} maxLength={60} placeholder="Prometheus production" aria-label="Nom de la source" className={INPUT} />
        <select value={f.kind} onChange={e => setF(x => ({ ...x, kind: e.target.value }))} aria-label="Outil de supervision" className={INPUT}>{Object.entries(d.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={f.priority} onChange={e => setF(x => ({ ...x, priority: e.target.value }))} aria-label="Priorité des tickets" className={INPUT}>{Object.entries(PRIO).map(([k, l]) => <option key={k} value={k}>{`Priorité : ${l}`}</option>)}</select>
        <select value={f.teamId} onChange={e => setF(x => ({ ...x, teamId: e.target.value }))} aria-label="Équipe des tickets" className={INPUT}><option value="">Équipe : aucune</option>{teams.map(t => <option key={t.id} value={t.id}>{`Équipe : ${t.name}`}</option>)}</select>
        <input value={f.subject} onChange={e => setF(x => ({ ...x, subject: e.target.value }))} maxLength={100} placeholder="Sujet (facultatif : sinon le titre de l'alerte)" aria-label="Sujet des tickets" className={INPUT} />
        <label className="flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" checked={f.autoClose} onChange={e => setF(x => ({ ...x, autoClose: e.target.checked }))} className="accent-primary" />Fermer à la fin de l'alerte</label>
      </div>
      <button type="button" disabled={!f.name.trim()} onClick={() => act(api.post('/monitoring-sources', { ...f, teamId: f.teamId || null }), 'Source ajoutée').then(ok => ok && setF(x => ({ ...x, name: '' })))} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white inline-flex items-center gap-1 disabled:opacity-50"><Plus size={12} /> Ajouter la source</button>
    </div>
  );
}
