import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Widget → Arbre de questions (v7, utils/widgetBot.js): steps with a message and buttons, no AI
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const KIND_LABELS = { step: 'Aller à l\'étape', article: 'Ouvrir un article', human: 'Parler à quelqu\'un', form: 'Écrire un message' };
const newId = nodes => { let i = nodes.length + 1; while (nodes.some(n => n.id === `etape${i}`)) i++; return `etape${i}`; };

export default function WidgetBotEditor() {
  const [b, setB] = useState(null);
  const [articles, setArticles] = useState([]);
  useEffect(() => {
    api.get('/widget-settings/bot').then(r => setB(Array.isArray(r.data?.nodes) ? r.data : false)).catch(() => setB(false));
    api.get('/faq').then(r => setArticles((Array.isArray(r.data) ? r.data : r.data?.entries || []).filter(a => a.visibility === 'public'))).catch(() => {});
  }, []);
  if (!b) return null;
  const setNode = (i, patch) => setB(x => ({ ...x, nodes: x.nodes.map((n, j) => (j === i ? { ...n, ...patch } : n)) }));
  const setBtn = (i, k, patch) => setNode(i, { buttons: b.nodes[i].buttons.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
  const save = async () => { try { const d = (await api.put('/widget-settings/bot', b)).data; if (Array.isArray(d?.nodes)) setB(d); toast.success('Arbre enregistré'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-ink-3">Avant le chat ou le formulaire, le widget peut guider le visiteur par des étapes à boutons : réponses courantes, articles, puis « Parler à quelqu'un » (toujours proposé). Le parcours suivi est joint au ticket.</p>
      <label className="flex items-center gap-2 text-sm text-ink-1"><input type="checkbox" checked={b.enabled} onChange={e => setB(x => ({ ...x, enabled: e.target.checked }))} className="accent-primary" />Afficher l'arbre de questions</label>
      {b.nodes.map((n, i) => (
        <div key={i} className="rounded-xl border border-overlay/8 p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <input value={n.id} onChange={e => setNode(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) })} aria-label="Identifiant de l'étape" className={`${INPUT} w-32! font-mono`} />
            {b.start === n.id || (!b.start && i === 0) ? <span className="text-[11px] text-emerald-300">Première étape</span>
              : <button type="button" onClick={() => setB(x => ({ ...x, start: n.id }))} className="text-[11px] text-ink-3 hover:text-ink-1 underline">En faire la première</button>}
            <button type="button" onClick={() => setB(x => ({ ...x, nodes: x.nodes.filter((_, j) => j !== i) }))} aria-label={`Supprimer l'étape « ${n.id} »`} className="ml-auto text-ink-4 hover:text-red-400"><Trash2 size={12} /></button>
          </div>
          <textarea value={n.text} onChange={e => setNode(i, { text: e.target.value })} rows={2} maxLength={1000} placeholder="Bonjour ! Votre question porte sur…" aria-label={`Message de l'étape « ${n.id} »`} className={INPUT} />
          {n.buttons.map((x, k) => (
            <div key={k} className="flex flex-wrap gap-1.5">
              <input value={x.label} onChange={e => setBtn(i, k, { label: e.target.value })} maxLength={60} placeholder="Une livraison" aria-label="Texte du bouton" className={`${INPUT} w-40!`} />
              <select value={x.kind} onChange={e => setBtn(i, k, { kind: e.target.value })} aria-label="Ce que fait le bouton" className={`${INPUT} w-40!`}>{Object.entries(KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              {x.kind === 'step' && <select value={x.next || ''} onChange={e => setBtn(i, k, { next: e.target.value })} aria-label="Étape suivante" className={`${INPUT} w-36!`}><option value="">—</option>{b.nodes.filter(o => o.id !== n.id).map(o => <option key={o.id} value={o.id}>{o.id}</option>)}</select>}
              {x.kind === 'article' && <select value={x.articleId || ''} onChange={e => setBtn(i, k, { articleId: Number(e.target.value) })} aria-label="Article public" className={`${INPUT} flex-1`}><option value="">—</option>{articles.map(a => <option key={a.id} value={a.id}>{a.question}</option>)}</select>}
              <button type="button" onClick={() => setNode(i, { buttons: n.buttons.filter((_, j) => j !== k) })} aria-label="Retirer le bouton" className="text-ink-4 hover:text-red-400"><X size={12} /></button>
            </div>
          ))}
          {n.buttons.length < 6 && <button type="button" onClick={() => setNode(i, { buttons: [...n.buttons, { label: '', kind: 'step', next: '' }] })} className="text-[11px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><Plus size={11} /> Bouton</button>}
        </div>
      ))}
      <div className="flex gap-2">
        {b.nodes.length < 50 && <button type="button" onClick={() => setB(x => ({ ...x, nodes: [...x.nodes, { id: newId(x.nodes), text: '', buttons: [] }] }))} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1"><Plus size={12} /> Étape</button>}
        <button type="button" onClick={save} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white">Enregistrer l'arbre</button>
      </div>
    </div>
  );
}
