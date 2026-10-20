import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, ListPlus } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../utils/confirmToast';

const input = 'bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:border-primary/50';

// Custom ticket fields asked to members in DM after the subject
export default function Fields() {
  const [fields, setFields] = useState(null);
  const [form, setForm] = useState({ label: '', type: 'text', required: false, subject: '' });
  const load = useCallback(() => {
    api.get('/fields').then(r => setFields(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post('/fields', { ...form, subject: form.subject.trim() || null, position: fields.length });
      setForm({ label: '', type: 'text', required: false, subject: '' });
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const patch = async (f, body) => {
    try { await api.patch(`/fields/${f.id}`, body); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const renameVar = async (f) => {
    const v = window.prompt(`Nom de la variable pour « ${f.label} » (lettres minuscules, chiffres et _ ; vide = automatique)`, f.var_name || f.variable);
    if (v === null) return;
    await patch(f, { var_name: v.trim() });
  };
  const remove = async (f) => {
    if (!await confirmToast(`Supprimer le champ « ${f.label} » et toutes ses valeurs ?`)) return;
    try { await api.delete(`/fields/${f.id}`); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1">Champs personnalisés</h1>
        <p className="text-sm text-ink-3">Informations demandées au membre en MP après le sujet (n° de commande, pseudo en jeu…). Elles apparaissent dans la fiche du ticket, dans le salon Discord, servent de filtre dans la liste, et se reprennent dans les modèles de réponse avec leur variable (ex. <code>{'{{commande}}'}</code>).</p>
      </div>

      <form onSubmit={add} className="bg-overlay/3 rounded-2xl border border-overlay/6 p-4 grid grid-cols-1 md:grid-cols-[2fr_1fr_1.5fr_auto_auto] gap-2 items-center">
        <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} maxLength={80} placeholder="Libellé (ex : N° de commande)" aria-label="Libellé" className={input} />
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} aria-label="Type" className={input}>
          <option value="text">Texte</option><option value="number">Nombre</option>
        </select>
        <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} maxLength={100} placeholder="Sujet (vide = tous)" aria-label="Sujet concerné" className={input} />
        <label className="flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" checked={form.required} onChange={e => setForm(f => ({ ...f, required: e.target.checked }))} /> Obligatoire</label>
        <button type="submit" disabled={!form.label.trim()} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-primary hover:bg-primary-light disabled:opacity-50">
          <Plus size={13} /> Ajouter
        </button>
      </form>

      <div className="bg-overlay/3 rounded-2xl border border-overlay/6 overflow-hidden">
        {fields === null ? (
          <div className="flex justify-center py-12"><Loader2 size={18} className="animate-spin text-ink-3" /></div>
        ) : fields.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-4 flex flex-col items-center gap-2"><ListPlus size={18} /> Aucun champ</p>
        ) : (
          <ul className="divide-y divide-overlay/5">
            {fields.map(f => (
              <li key={f.id} className={`px-5 py-3 flex items-center gap-3 ${f.active ? '' : 'opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-1">{f.label}</p>
                  <p className="text-[11px] text-ink-4">
                    {f.type === 'number' ? 'Nombre' : 'Texte'} · {f.required ? 'obligatoire' : 'facultatif'} · {f.subject ? `sujet « ${f.subject} »` : 'tous les sujets'}{f.active ? '' : ' · désactivé'}
                  </p>
                  <p className="text-[11px] text-ink-3 mt-0.5">
                    Variable des modèles : <code className="px-1 rounded bg-overlay/6 text-primary-light">{`{{${f.variable}}}`}</code>
                    <button onClick={() => renameVar(f)} className="ml-2 underline text-ink-4 hover:text-ink-1">modifier</button>
                  </p>
                </div>
                <button onClick={() => patch(f, { required: !f.required })} className="px-2 py-1 rounded-lg text-[11px] text-ink-3 hover:text-ink-1 hover:bg-overlay/5">{f.required ? 'Rendre facultatif' : 'Rendre obligatoire'}</button>
                <button onClick={() => patch(f, { active: !f.active })} className="px-2 py-1 rounded-lg text-[11px] text-ink-3 hover:text-ink-1 hover:bg-overlay/5">{f.active ? 'Désactiver' : 'Activer'}</button>
                <button onClick={() => remove(f)} aria-label={`Supprimer ${f.label}`} className="p-1.5 rounded-lg text-ink-3 hover:text-red-400 hover:bg-red-400/10"><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
