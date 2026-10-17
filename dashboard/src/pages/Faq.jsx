import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, HelpCircle, FlaskConical, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../utils/confirmToast';
import { useAuth } from '../App';

const input = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:border-primary/50';

function EntryModal({ entry, onClose, onSave }) {
  const [form, setForm] = useState({ question: entry?.question || '', answer: entry?.answer || '', keywords: entry?.keywords || '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.question.trim() || !form.answer.trim()) return toast.error('Question et réponse requises');
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-surface-card border border-overlay/8 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-1">{entry ? 'Modifier l\'entrée' : 'Nouvelle entrée de FAQ'}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink-2"><X size={16} /></button>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-3">Question</span>
          <input value={form.question} onChange={e => set('question', e.target.value)} maxLength={200} placeholder="Comment changer mon mot de passe ?" className={input} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-3">Réponse envoyée au membre</span>
          <textarea value={form.answer} onChange={e => set('answer', e.target.value)} maxLength={2000} rows={5} className={`${input} resize-none`} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-3">Mots-clés (séparés par des virgules)</span>
          <input value={form.keywords} onChange={e => set('keywords', e.target.value)} maxLength={500} placeholder="mot de passe, mdp, connexion" className={input} />
          <span className="block text-[10px] text-ink-4">Un mot-clé trouvé dans le message compte plus qu'un mot commun avec la question.</span>
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1 hover:bg-overlay/5">Annuler</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary-light disabled:opacity-60">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Faq() {
  const { user } = useAuth();
  const canManage = user?.role === 'fondateur' || user?.permissions?.includes('manage_settings');
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // entry, or {} for a new one
  const [sample, setSample] = useState('');
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => {
    api.get('/faq').then(r => setData(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    if (editing?.id) await api.patch(`/faq/${editing.id}`, form);
    else await api.post('/faq', form);
    toast.success('Entrée enregistrée');
    load();
  };
  const toggleEntry = async (e) => {
    try { await api.patch(`/faq/${e.id}`, { active: !e.active }); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const remove = async (e) => {
    if (!await confirmToast(`Supprimer « ${e.question} » ?`)) return;
    try { await api.delete(`/faq/${e.id}`); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const toggleEnabled = async () => {
    try { await api.put('/faq/enabled', { enabled: !data.enabled }); load(); toast.success(data.enabled ? 'FAQ automatique désactivée' : 'FAQ automatique activée'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const runPreview = async () => {
    if (!sample.trim()) return;
    try { setPreview((await api.post('/faq/preview', { message: sample })).data); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  if (!data) return <div className="flex justify-center py-24"><Loader2 size={20} className="animate-spin text-ink-3" /></div>;
  const shown = data.entries.reduce((n, e) => n + e.shown_count, 0);
  const solved = data.entries.reduce((n, e) => n + e.solved_count, 0);

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {editing && <EntryModal entry={editing.id ? editing : null} onClose={() => setEditing(null)} onSave={save} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink-1">FAQ automatique</h1>
          <p className="text-sm text-ink-3">Avant d'ouvrir un ticket, le bot propose au membre les réponses qui correspondent à son message.</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button onClick={toggleEnabled} role="switch" aria-checked={data.enabled}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border ${data.enabled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-overlay/4 text-ink-3 border-overlay/8'}`}>
              {data.enabled ? 'Activée' : 'Désactivée'}
            </button>
            <button onClick={() => setEditing({})} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-primary hover:bg-primary-light">
              <Plus size={13} /> Nouvelle entrée
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[['Entrées actives', data.entries.filter(e => e.active).length], ['Réponses proposées', shown], ['Questions résolues sans ticket', `${solved}${shown ? ` (${Math.round((solved / shown) * 100)} %)` : ''}`]].map(([label, value]) => (
          <div key={label} className="bg-overlay/3 rounded-2xl border border-overlay/6 p-4">
            <p className="text-[11px] text-ink-4">{label}</p>
            <p className="text-2xl font-bold text-ink-1 tabular-nums mt-1">{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-overlay/3 rounded-2xl border border-overlay/6 p-4 space-y-2">
        <p className="text-xs font-semibold text-ink-2 flex items-center gap-1.5"><FlaskConical size={13} /> Tester un message de membre</p>
        <div className="flex gap-2">
          <input value={sample} onChange={e => setSample(e.target.value)} onKeyDown={e => e.key === 'Enter' && runPreview()}
            placeholder="Bonjour, j'ai oublié mon mot de passe…" className={input} />
          <button onClick={runPreview} className="px-3 py-2 rounded-xl text-xs text-ink-2 border border-overlay/8 hover:bg-overlay/5 shrink-0">Tester</button>
        </div>
        {preview && (preview.length === 0
          ? <p className="text-[11px] text-ink-4">Aucune entrée proposée : le ticket s'ouvrirait directement.</p>
          : <ul className="text-[11px] text-ink-2 space-y-0.5">{preview.map(p => <li key={p.id}>• {p.question} <span className="text-ink-4">(score {p.score})</span></li>)}</ul>)}
      </div>

      <div className="bg-overlay/3 rounded-2xl border border-overlay/6 overflow-hidden">
        {data.entries.length === 0 ? (
          <div className="py-14 text-center text-sm text-ink-4 flex flex-col items-center gap-2">
            <HelpCircle size={20} /> Aucune entrée pour l'instant
          </div>
        ) : (
          <ul className="divide-y divide-overlay/5">
            {data.entries.map(e => (
              <li key={e.id} className={`px-5 py-4 flex gap-4 ${e.active ? '' : 'opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-1">{e.question}</p>
                  <p className="text-xs text-ink-3 mt-1 line-clamp-2 whitespace-pre-wrap">{e.answer}</p>
                  <p className="text-[10px] text-ink-4 mt-1.5">
                    {e.keywords ? `Mots-clés : ${e.keywords} · ` : ''}proposée {e.shown_count} fois · a résolu {e.solved_count} question(s)
                    {!e.active && ' · désactivée'}
                  </p>
                </div>
                {canManage && (
                  <div className="flex items-start gap-1 shrink-0">
                    <button onClick={() => toggleEntry(e)} className="px-2 py-1 rounded-lg text-[11px] text-ink-3 hover:text-ink-1 hover:bg-overlay/5">
                      {e.active ? 'Désactiver' : 'Activer'}
                    </button>
                    <button onClick={() => setEditing(e)} title="Modifier" className="p-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/5"><Pencil size={13} /></button>
                    <button onClick={() => remove(e)} title="Supprimer" className="p-1.5 rounded-lg text-ink-3 hover:text-red-400 hover:bg-red-400/10"><Trash2 size={13} /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
