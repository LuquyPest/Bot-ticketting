import React, { useEffect, useState } from 'react';
import { Coins, Trash2, Plus } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';

// Fiche ticket → Coût (v5.4): founders and the manage_costs permission
export default function CostPanel({ ticketId, panelCard }) {
  const [c, setC] = useState(null);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const ok = d => (d && Array.isArray(d.time) ? d : false);
  useEffect(() => { api.get(`/costs/tickets/${ticketId}`).then(r => setC(ok(r.data))).catch(() => setC(false)); }, [ticketId]);
  if (!c) return null;
  const money = v => new Intl.NumberFormat(uiLocale(), { style: 'currency', currency: c.currency || 'EUR' }).format((v || 0) / 100);
  const act = async p => { try { const d = ok((await p).data); if (d) setC(d); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const add = () => act(api.post(`/costs/tickets/${ticketId}`, { label, amountCents: Math.round((parseFloat(amount.replace(',', '.')) || 0) * 100) })).then(() => { setLabel(''); setAmount(''); });
  return (
    <div className={panelCard}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-2 inline-flex items-center gap-1.5"><Coins size={12} aria-hidden="true" />{`Coût · ${money(c.totalCents)}`}</p>
      <ul className="text-xs space-y-0.5 text-ink-2">
        {c.time.map(t => <li key={t.userId} className="flex justify-between gap-2"><span>{`${t.userTag} · ${Math.round(t.seconds / 60)} min`}</span><span className="tabular-nums">{money(t.cents)}</span></li>)}
        {c.fixedCents > 0 && <li className="flex justify-between gap-2"><span>Forfait</span><span className="tabular-nums">{money(c.fixedCents)}</span></li>}
        {c.extras.map(x => (
          <li key={x.id} className="flex justify-between gap-2"><span className="truncate">{x.label}</span><span className="tabular-nums inline-flex items-center gap-1">{money(x.amountCents)}
            <button type="button" onClick={() => act(api.delete(`/costs/tickets/${ticketId}/${x.id}`))} aria-label={`Retirer le frais ${x.label}`} className="text-ink-4 hover:text-red-400"><Trash2 size={11} /></button></span></li>
        ))}
      </ul>
      <div className="flex gap-1.5 mt-2">
        <input value={label} onChange={e => setLabel(e.target.value)} maxLength={120} placeholder="Déplacement" aria-label="Libellé du frais" className="flex-1 min-w-0 bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1 text-xs" />
        <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" aria-label="Montant du frais" className="w-16 bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1 text-xs" />
        <button type="button" onClick={add} disabled={!label.trim() || !amount} aria-label="Ajouter le frais" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={12} /></button>
      </div>
    </div>
  );
}
