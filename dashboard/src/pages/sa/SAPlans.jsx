import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Loader2, Layers } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../../utils/confirmToast';

const FIELDS = [
  ['max_tickets', 'Tickets ouverts simultanés'],
  ['max_agents', 'Membres du staff'],
  ['transcript_retention_days', 'Conservation des transcripts (jours)'],
];
const input = 'w-full px-3 py-2 rounded-xl bg-overlay/4 border border-overlay/8 text-sm text-ink-1 outline-hidden focus:border-primary/50';
const show = v => (v > 0 ? v : '∞');

function PlanModal({ plan, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: plan?.name || '', description: plan?.description || '',
    ...Object.fromEntries(FIELDS.map(([k]) => [k, String(plan?.[k] ?? 0)])),
  });
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    const body = { name: form.name, description: form.description || null };
    for (const [k, label] of FIELDS) {
      const n = Number(form[k]);
      if (!Number.isInteger(n) || n < 0) return toast.error(`${label} : nombre entier positif attendu`);
      body[k] = n;
    }
    setSaving(true);
    try {
      const { data } = plan?.id ? await api.patch(`/sa/plans/${plan.id}`, body) : await api.post('/sa/plans', body);
      toast.success(plan?.id && data.propagated ? `Formule enregistrée — ${data.propagated} serveur(s) mis à jour` : 'Formule enregistrée');
      onSaved(); onClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <form onSubmit={save} className="glass-dark rounded-2xl border border-overlay/8 p-6 w-full max-w-md space-y-3 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-1">{plan?.id ? 'Modifier la formule' : 'Nouvelle formule'}</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink-1"><X size={16} /></button>
        </div>
        <label className="block space-y-1"><span className="text-xs text-ink-2">Nom</span>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} maxLength={60} className={input} /></label>
        <label className="block space-y-1"><span className="text-xs text-ink-2">Description</span>
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} maxLength={255} className={input} /></label>
        {FIELDS.map(([k, label]) => (
          <label key={k} className="block space-y-1"><span className="text-xs text-ink-2">{label} <span className="text-ink-4">(0 = illimité)</span></span>
            <input type="number" min={0} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className={`${input} tabular-nums`} /></label>
        ))}
        {plan?.id > 0 && plan.guild_count > 0 && <p className="text-[11px] text-amber-300">Les limites s'appliqueront aux {plan.guild_count} serveur(s) sur cette formule.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1 hover:bg-overlay/5">Annuler</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary-light disabled:opacity-60">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function SAPlans() {
  const [plans, setPlans] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => {
    api.get('/sa/plans').then(r => setPlans(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, []);
  useEffect(() => { load(); }, [load]);
  const remove = async (p) => {
    if (!await confirmToast(`Supprimer la formule « ${p.name} » ? Ses ${p.guild_count} serveur(s) gardent leurs limites actuelles (personnalisées).`)) return;
    try { await api.delete(`/sa/plans/${p.id}`); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {editing && <PlanModal plan={editing} onClose={() => setEditing(null)} onSaved={load} />}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink-1">Formules</h1>
          <p className="text-sm text-ink-3">Jeux de limites à attribuer aux serveurs (fenêtre « Limites »). Les fondateurs sont prévenus à 80 % et à 100 % d'une limite.</p>
        </div>
        <button onClick={() => setEditing({})} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-primary hover:bg-primary-light">
          <Plus size={13} /> Nouvelle formule
        </button>
      </div>
      <div className="glass-dark rounded-2xl border border-overlay/8 overflow-hidden">
        {plans === null ? (
          <div className="flex justify-center py-12"><Loader2 size={18} className="animate-spin text-ink-3" /></div>
        ) : plans.length === 0 ? (
          <p className="py-12 text-center text-xs text-ink-4 flex flex-col items-center gap-2"><Layers size={18} /> Aucune formule</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-ink-4 border-b border-overlay/6">
                {['Formule', 'Tickets', 'Staff', 'Transcripts', 'Serveurs', ''].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-overlay/4">
              {plans.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-3"><p className="text-sm font-semibold text-ink-1">{p.name}</p>{p.description && <p className="text-[11px] text-ink-4">{p.description}</p>}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">{show(p.max_tickets)}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">{show(p.max_agents)}</td>
                  <td className="px-4 py-3 text-ink-2">{p.transcript_retention_days > 0 ? `${p.transcript_retention_days} j` : 'Illimité'}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-2">{p.guild_count}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(p)} title="Modifier" className="p-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/5"><Pencil size={13} /></button>
                    <button onClick={() => remove(p)} title="Supprimer" className="p-1.5 rounded-lg text-ink-3 hover:text-red-400 hover:bg-red-400/10"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
