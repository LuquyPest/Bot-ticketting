import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Check, Tag } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../utils/confirmToast';

const PRESET_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316',
  '#eab308','#22c55e','#14b8a6','#3b82f6','#64748b'
];

function TagModal({ tag, onClose, onSave }) {
  const [name, setName] = useState(tag?.name || '');
  const [color, setColor] = useState(tag?.color || '#6366f1');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast.error('Nom requis');
    setSaving(true);
    try {
      await onSave({ name: name.trim(), color });
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface-card border border-white/[0.08] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-ink-1">{tag ? 'Modifier le tag' : 'Nouveau tag'}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink-2"><X size={16} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-ink-3 mb-1.5 block">Nom</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="Ex : Bug, Facturation..."
              className="w-full bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs text-ink-3 mb-1.5 block">Couleur</label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                className="w-7 h-7 rounded-full cursor-pointer bg-transparent border-0 p-0" />
            </div>
            <div className="mt-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border"
                style={{ backgroundColor: `${color}20`, color, borderColor: `${color}40` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                {name || 'Aperçu'}
              </span>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-surface text-ink-2 text-sm hover:bg-surface-hover transition-colors">Annuler</button>
            <button onClick={submit} disabled={saving || !name.trim()}
              className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50">
              {saving ? 'Enregistrement...' : (tag ? 'Modifier' : 'Créer')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Tags() {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/tags').then(r => setTags(r.data)).catch(() => toast.error('Erreur chargement')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (data) => {
    const r = await api.post('/tags', data);
    setTags(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)));
    toast.success('Tag créé');
  };

  const update = async (tag, data) => {
    await api.patch(`/tags/${tag.id}`, data);
    setTags(prev => prev.map(t => t.id === tag.id ? { ...t, ...data } : t));
    toast.success('Tag mis à jour');
  };

  const remove = async (tag) => {
    if (!await confirmToast(`Supprimer le tag "${tag.name}" ?`)) return;
    try {
      await api.delete(`/tags/${tag.id}`);
      setTags(prev => prev.filter(t => t.id !== tag.id));
      toast.success('Tag supprimé');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  return (
    <div className="p-6 space-y-5">
      {modal?.mode === 'create' && (
        <TagModal tag={null} onClose={() => setModal(null)} onSave={create} />
      )}
      {modal?.mode === 'edit' && (
        <TagModal tag={modal.tag} onClose={() => setModal(null)} onSave={data => update(modal.tag, data)} />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Tag size={20} className="text-primary-light" />
          <div>
            <h1 className="text-xl font-bold text-ink-1">Tags</h1>
            <p className="text-sm text-ink-3">{tags.length} tag(s) — assignables aux tickets</p>
          </div>
        </div>
        <button onClick={() => setModal({ mode: 'create' })}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
          <Plus size={14} /> Nouveau tag
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-ink-4 text-sm">Chargement...</div>
      ) : tags.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Tag size={36} className="text-ink-4 mx-auto" />
          <p className="text-ink-3 text-sm">Aucun tag créé</p>
          <p className="text-ink-4 text-xs">Créez des tags pour les assigner aux tickets et filtrer plus facilement.</p>
          <button onClick={() => setModal({ mode: 'create' })}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
            <Plus size={14} /> Créer le premier tag
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {tags.map(tag => (
            <div key={tag.id}
              className="group flex items-center gap-3 bg-surface-card border border-white/[0.06] hover:border-white/[0.08] rounded-xl px-4 py-3 transition-colors">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border"
                style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}40` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setModal({ mode: 'edit', tag })}
                  className="p-1 rounded text-ink-4 hover:text-ink-2 hover:bg-surface transition-colors">
                  <Pencil size={12} />
                </button>
                <button onClick={() => remove(tag)}
                  className="p-1 rounded text-ink-4 hover:text-red-400 hover:bg-red-400/10 transition-colors">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-surface-card/50 border border-white/[0.06] rounded-2xl p-4">
        <p className="text-xs text-ink-3 leading-relaxed">
          Les tags peuvent être assignés à n'importe quel ticket depuis la page de détail du ticket.
          Ils permettent de catégoriser les tickets librement (ex : Bug, Facturation, Urgent, VIP...).
        </p>
      </div>
    </div>
  );
}
