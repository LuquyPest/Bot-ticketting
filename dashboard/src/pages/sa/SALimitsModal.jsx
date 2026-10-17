import React, { useEffect, useState } from 'react';
import { Gauge, Loader2, X } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';

const FIELDS = [
  { key: 'max_tickets', label: 'Tickets ouverts simultanés', hint: 'Au-delà, les membres ne peuvent plus ouvrir de ticket' },
  { key: 'max_agents', label: 'Membres du staff', hint: 'Support et fondateurs ayant accès au dashboard' },
  { key: 'transcript_retention_days', label: 'Conservation des transcripts (jours)', hint: 'Les transcripts plus anciens sont purgés chaque nuit' },
];

// Per-guild resource limits set by the super-admin (0 = unlimited).
export default function SALimitsModal({ guild, onClose, onSaved }) {
  const [values, setValues] = useState(() => Object.fromEntries(FIELDS.map(f => [f.key, String(guild[f.key] ?? 0)])));
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState(guild.plan_id ? String(guild.plan_id) : '');
  useEffect(() => { api.get('/sa/plans').then(r => setPlans(r.data)).catch(() => {}); }, []);

  // Choosing a plan applies its limits; editing a value by hand makes the server "custom"
  const applyPlan = async (id) => {
    setPlanId(id);
    if (!id) return;
    setSaving(true);
    try {
      const { data } = await api.put(`/sa/guilds/${guild.guild_id}/plan`, { planId: parseInt(id) });
      toast.success(`Formule « ${data.plan.name} » appliquée à ${guild.guild_name}`);
      onSaved?.();
      onClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setSaving(false);
  };

  const save = async (e) => {
    e.preventDefault();
    const body = {};
    for (const f of FIELDS) {
      const n = Number(values[f.key]);
      if (!Number.isInteger(n) || n < 0) return toast.error(`${f.label} : nombre entier positif attendu`);
      body[f.key] = n;
    }
    setSaving(true);
    try {
      await api.patch(`/sa/guilds/${guild.guild_id}/limits`, body);
      toast.success(`Limites de ${guild.guild_name} enregistrées`);
      onSaved?.(body);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <form onSubmit={save} className="glass-dark rounded-2xl border border-overlay/8 p-6 w-full max-w-md space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-1 flex items-center gap-2">
            <Gauge size={15} className="text-red-400" /> Limites — {guild.guild_name}
          </h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink-1"><X size={16} /></button>
        </div>
        {plans.length > 0 && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-2">Formule</span>
            <select value={planId} onChange={e => applyPlan(e.target.value)} disabled={saving}
              className="w-full px-3 py-2 rounded-xl bg-overlay/4 border border-overlay/8 text-sm text-ink-1 outline-hidden focus:border-primary/50">
              <option value="">Personnalisée (valeurs ci-dessous)</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <p className="text-[11px] text-ink-4">0 = illimité. Enregistrer des valeurs à la main détache le serveur de sa formule.</p>
        {FIELDS.map(f => (
          <label key={f.key} className="block space-y-1">
            <span className="text-xs font-medium text-ink-2">{f.label}</span>
            <input type="number" min={0} step={1} value={values[f.key]}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl bg-overlay/4 border border-overlay/8 text-sm text-ink-1
                         outline-hidden focus:border-primary/50 tabular-nums" />
            <span className="block text-[10px] text-ink-4">{f.hint}</span>
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1 hover:bg-overlay/5">Annuler</button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary-light disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 size={13} className="animate-spin" />} Enregistrer
          </button>
        </div>
      </form>
    </div>
  );
}
