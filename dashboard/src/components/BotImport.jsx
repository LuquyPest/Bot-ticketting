import React, { useState } from 'react';
import { Search, Download, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Taking over the open tickets of another bot (Paramètres → Sauvegarde): scan a category, pick the
// channels, adopt them as tickets of this bot (utils/botImport.js)
export default function BotImport({ categories }) {
  const [categoryId, setCategoryId] = useState('');
  const [scan, setScan] = useState(null);
  const [chosen, setChosen] = useState(new Set());
  const [opts, setOpts] = useState({ history: true, notify: true, move: true });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const doScan = async () => {
    setBusy(true); setResult(null);
    try {
      const { data } = await api.get('/bot-import/scan', { params: { categoryId } });
      setScan(data);
      setChosen(new Set(data.channels.filter(c => c.owner && !c.adopted).map(c => c.channelId)));
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const toggle = id => setChosen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const adopt = async () => {
    if (!window.confirm(`Reprendre ${chosen.size} ticket(s) ? Les salons restent en place ; ce bot les gère désormais.`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/bot-import/adopt', { categoryId, items: [...chosen].map(channelId => ({ channelId })), ...opts });
      setResult(data);
      toast.success(`${data.adopted.length} ticket(s) repris`);
      await doScan();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const opt = (k, label) => (
    <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
      <input type="checkbox" className="accent-primary" checked={opts[k]} onChange={e => setOpts(o => ({ ...o, [k]: e.target.checked }))} />{label}
    </label>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3">Ticket Tool, Tickets, Helper.gg… Choisis la catégorie où l'autre bot range ses tickets : chaque salon devient un ticket de ce bot, rattaché au membre trouvé dans ses permissions. Rien n'est supprimé.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-ink-2 font-medium flex-1 min-w-[14rem]">Catégorie de l'autre bot
          <select value={categoryId} onChange={e => { setCategoryId(e.target.value); setScan(null); }}
            className="mt-1 w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary">
            <option value="">Choisir…</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={doScan} disabled={!categoryId || busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">
          {busy && !scan ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}Analyser
        </button>
      </div>

      {scan && (
        scan.channels.length === 0 ? <p className="text-xs text-ink-4">Aucun salon textuel dans cette catégorie.</p> : (
          <>
            <ul className="divide-y divide-overlay/6 border border-overlay/6 rounded-lg max-h-72 overflow-y-auto">
              {scan.channels.map(c => (
                <li key={c.channelId} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <input type="checkbox" className="accent-primary" aria-label={`Reprendre #${c.name}`} disabled={!c.owner || c.adopted}
                    checked={chosen.has(c.channelId)} onChange={() => toggle(c.channelId)} />
                  <span className="text-ink-1 font-medium truncate flex-1" translate="no">#{c.name}</span>
                  {c.adopted ? <span className="text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 size={12} aria-hidden="true" />déjà repris</span>
                    : c.owner ? <span className="text-ink-3" translate="no">{c.owner.tag}</span>
                      : <span className="text-amber-300 inline-flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" />membre introuvable</span>}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {opt('history', 'Copier les 100 derniers messages dans l\'historique')}
              {opt('notify', 'Prévenir chaque membre en MP')}
              {opt('move', 'Déplacer les salons dans la catégorie « Ouvert »')}
            </div>
            <button type="button" onClick={adopt} disabled={!chosen.size || busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-primary text-white hover:bg-primary-light disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}Reprendre {chosen.size} ticket(s)
            </button>
          </>
        )
      )}
      {result?.skipped?.length > 0 && (
        <div role="status" className="text-xs text-amber-300">
          <p>Non repris :</p>
          <ul className="list-disc pl-5">{result.skipped.map(s => <li key={s.channelId}>{s.name ? `#${s.name}` : s.channelId} — {s.reason}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
