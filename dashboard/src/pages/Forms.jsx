import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, X, GripVertical, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const BASE = "w-full bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors";

const EMPTY_FIELD = () => ({ label: '', placeholder: '', style: 'short', required: true, min_length: null, max_length: null });

function FieldEditor({ field, index, total, onChange, onRemove, onMove }) {
  return (
    <div className="bg-surface-card border border-white/[0.06] rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <GripVertical size={14} className="text-ink-4 flex-shrink-0" />
        <span className="text-xs font-semibold text-ink-3 flex-1">Champ {index + 1}</span>
        <button onClick={() => onMove(index, -1)} disabled={index === 0}
          className="p-1 text-ink-4 hover:text-ink-2 disabled:opacity-30 transition-colors">
          <ChevronUp size={14} />
        </button>
        <button onClick={() => onMove(index, 1)} disabled={index === total - 1}
          className="p-1 text-ink-4 hover:text-ink-2 disabled:opacity-30 transition-colors">
          <ChevronDown size={14} />
        </button>
        <button onClick={() => onRemove(index)} className="p-1 text-red-400/60 hover:text-red-400 transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-ink-3 block mb-1">Label <span className="text-red-400">*</span></label>
          <input type="text" value={field.label} maxLength={45}
            onChange={e => onChange(index, 'label', e.target.value)}
            placeholder="Ex: Motif de la demande" className={BASE} />
        </div>
        <div>
          <label className="text-xs text-ink-3 block mb-1">Placeholder</label>
          <input type="text" value={field.placeholder || ''} maxLength={100}
            onChange={e => onChange(index, 'placeholder', e.target.value)}
            placeholder="Texte indicatif (optionnel)" className={BASE} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-ink-3 block mb-1">Type</label>
          <select value={field.style} onChange={e => onChange(index, 'style', e.target.value)} className={BASE + " cursor-pointer"}>
            <option value="short">Ligne courte</option>
            <option value="paragraph">Paragraphe</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-3 block mb-1">Min. caractères</label>
          <input type="number" min={0} max={4000}
            value={field.min_length ?? ''} onChange={e => onChange(index, 'min_length', e.target.value ? parseInt(e.target.value) : null)}
            placeholder="—" className={BASE} />
        </div>
        <div>
          <label className="text-xs text-ink-3 block mb-1">Max. caractères</label>
          <input type="number" min={1} max={4000}
            value={field.max_length ?? ''} onChange={e => onChange(index, 'max_length', e.target.value ? parseInt(e.target.value) : null)}
            placeholder="—" className={BASE} />
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={field.required} onChange={e => onChange(index, 'required', e.target.checked)}
          className="accent-primary w-3.5 h-3.5" />
        <span className="text-xs text-ink-3">Champ obligatoire</span>
      </label>
    </div>
  );
}

function FormEditor({ form, onSave, onCancel }) {
  const [name, setName]       = useState(form?.name || '');
  const [subject, setSubject] = useState(form?.subject || '');
  const [active, setActive]   = useState(form?.active !== false);
  const [fields, setFields]   = useState(form?.fields?.map(f => ({ ...f })) || []);
  const [saving, setSaving]   = useState(false);

  const addField = () => {
    if (fields.length >= 5) { toast.error('Maximum 5 champs (limite Discord)'); return; }
    setFields(f => [...f, EMPTY_FIELD()]);
  };

  const removeField = (i) => setFields(f => f.filter((_, idx) => idx !== i));

  const changeField = (i, key, val) => setFields(f => f.map((fld, idx) => idx === i ? { ...fld, [key]: val } : fld));

  const moveField = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    setFields(f => { const a = [...f]; [a[i], a[j]] = [a[j], a[i]]; return a; });
  };

  const save = async () => {
    if (!name.trim()) { toast.error('Nom requis'); return; }
    if (fields.some(f => !f.label.trim())) { toast.error('Tous les champs doivent avoir un label'); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), subject: subject.trim() || null, active: active ? 1 : 0, fields };
      let result;
      if (form?.id) {
        result = await api.patch(`/forms/${form.id}`, payload);
      } else {
        result = await api.post('/forms', payload);
      }
      toast.success(form?.id ? 'Formulaire mis à jour !' : 'Formulaire créé !');
      onSave(result.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-ink-3 block mb-1">Nom du formulaire <span className="text-red-400">*</span></label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={100}
            placeholder="Ex: Demande de support" className={BASE} />
        </div>
        <div>
          <label className="text-xs text-ink-3 block mb-1">Sujet associé</label>
          <input type="text" value={subject} onChange={e => setSubject(e.target.value)} maxLength={100}
            placeholder="Laisser vide = tous les sujets" className={BASE} />
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-primary w-3.5 h-3.5" />
        <span className="text-xs text-ink-3">Formulaire actif</span>
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-ink-3">Champs ({fields.length}/5)</span>
          <button onClick={addField}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            <Plus size={12} /> Ajouter un champ
          </button>
        </div>
        {fields.length === 0 && (
          <p className="text-xs text-ink-4 text-center py-4 border border-dashed border-white/[0.08] rounded-xl">
            Aucun champ — clique sur "Ajouter un champ"
          </p>
        )}
        {fields.map((f, i) => (
          <FieldEditor key={i} field={f} index={i} total={fields.length}
            onChange={changeField} onRemove={removeField} onMove={moveField} />
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-light text-white text-sm font-medium transition-colors disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'Sauvegarde…' : 'Sauvegarder'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface transition-colors text-sm">
          Annuler
        </button>
      </div>
    </div>
  );
}

export default function Forms() {
  const [forms, setForms]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | form object

  const load = () => {
    setLoading(true);
    api.get('/forms').then(r => setForms(r.data)).catch(() => toast.error('Erreur de chargement')).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const deleteForm = async (f) => {
    if (!confirm(`Supprimer le formulaire "${f.name}" ?`)) return;
    try {
      await api.delete(`/forms/${f.id}`);
      toast.success('Formulaire supprimé');
      setForms(prev => prev.filter(x => x.id !== f.id));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  };

  const handleSave = (saved) => {
    setForms(prev => {
      const idx = prev.findIndex(f => f.id === saved.id);
      return idx >= 0 ? prev.map(f => f.id === saved.id ? saved : f) : [saved, ...prev];
    });
    setEditing(null);
  };

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Formulaires d'intake</h1>
          <p className="text-sm text-ink-3 mt-0.5">Posez des questions lors de l'ouverture d'un ticket</p>
        </div>
        {!editing && (
          <button onClick={() => setEditing('new')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-light text-white text-sm font-medium transition-colors">
            <Plus size={15} /> Nouveau formulaire
          </button>
        )}
      </div>

      {editing && (
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-ink-2 mb-4">
            {editing === 'new' ? 'Nouveau formulaire' : `Modifier — ${editing.name}`}
          </h2>
          <FormEditor
            form={editing === 'new' ? null : editing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-ink-4" size={22} /></div>
      ) : forms.length === 0 && !editing ? (
        <div className="text-center py-12 text-ink-4 text-sm">Aucun formulaire créé.</div>
      ) : (
        <div className="space-y-3">
          {forms.map(f => (
            <div key={f.id} className="bg-surface-card border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink-1">{f.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${f.active ? 'bg-green-500/15 text-green-400' : 'bg-white/5 text-ink-4'}`}>
                      {f.active ? 'Actif' : 'Inactif'}
                    </span>
                    {f.subject && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{f.subject}</span>}
                  </div>
                  <p className="text-xs text-ink-4 mt-1">{f.fields?.length || 0} champ{f.fields?.length !== 1 ? 's' : ''}</p>
                  {f.fields?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {f.fields.map((fld, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 bg-surface rounded-lg text-ink-3 border border-white/[0.05]">
                          {fld.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setEditing(f)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-ink-2 transition-colors">
                    Modifier
                  </button>
                  <button onClick={() => deleteForm(f)}
                    className="p-1.5 rounded-lg text-red-400/50 hover:text-red-400 hover:bg-red-400/10 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
