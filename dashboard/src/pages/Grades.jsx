import React, { useEffect, useState, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, ChevronRight, Shield, RefreshCw,
  Check, X, Star
} from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';

const ALL_PERMISSIONS = [
  { id: 'view_tickets',        label: 'Voir les tickets' },
  { id: 'claim_ticket',        label: 'Prendre en charge' },
  { id: 'reply_ticket',        label: 'Répondre aux utilisateurs' },
  { id: 'close_ticket',        label: 'Fermer les tickets' },
  { id: 'manage_participants', label: 'Gérer les participants' },
  { id: 'view_transcripts',    label: 'Voir les transcripts' },
  { id: 'manage_users',        label: 'Gérer les utilisateurs' },
  { id: 'manage_grades',       label: 'Gérer les grades' },
  { id: 'manage_settings',     label: 'Paramètres du bot' },
  { id: 'view_audit',          label: 'Journal d\'audit' }
];

const PRESET_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316',
  '#eab308','#22c55e','#14b8a6','#3b82f6','#64748b'
];

function GradeModal({ grade, grades, onClose, onSave }) {
  const [name, setName] = useState(grade?.name || '');
  const [color, setColor] = useState(grade?.color || '#6366f1');
  const [parentId, setParentId] = useState(grade?.parent_id ?? '');
  const [perms, setPerms] = useState(new Set(grade?.permissions || []));
  const [saving, setSaving] = useState(false);

  const toggle = (perm) => {
    setPerms(prev => {
      const next = new Set(prev);
      next.has(perm) ? next.delete(perm) : next.add(perm);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.error('Nom requis');
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        color,
        parent_id: parentId ? parseInt(parentId) : null,
        permissions: [...perms]
      });
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const available = grades.filter(g => !grade || g.id !== grade.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="font-bold text-slate-100">{grade ? 'Modifier le grade' : 'Nouveau grade'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1 rounded-lg hover:bg-slate-800 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Nom du grade</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex : Chef Support"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Couleur</label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-7 h-7 rounded-full cursor-pointer bg-transparent border-0 p-0"
                title="Couleur personnalisée"
              />
              <span className="text-xs text-slate-500 font-mono">{color}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Grade parent (optionnel)</label>
            <select
              value={parentId}
              onChange={e => setParentId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">— Aucun parent (grade racine)</option>
              {available.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            {parentId && (
              <p className="text-xs text-slate-600 mt-1">
                Les membres avec ce grade pourront voir les tickets visibles par "{available.find(g => g.id === parseInt(parentId))?.name}" et en dessous.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Permissions</label>
            <div className="grid grid-cols-1 gap-1.5">
              {ALL_PERMISSIONS.map(p => (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors border ${
                    perms.has(p.id)
                      ? 'bg-indigo-600/15 border-indigo-600/30 text-slate-200'
                      : 'bg-slate-800/50 border-slate-700/30 text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                    perms.has(p.id) ? 'bg-indigo-500 border-indigo-500' : 'border-slate-600'
                  }`}>
                    {perms.has(p.id) && <Check size={10} className="text-white" />}
                  </div>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={perms.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span className="text-xs font-medium">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : (grade ? 'Modifier' : 'Créer')}
          </button>
        </div>
      </div>
    </div>
  );
}

function GradeCard({ grade, grades, onEdit, onDelete, onToggleDefault }) {
  const parentGrade = grade.parent_id ? grades.find(g => g.id === grade.parent_id) : null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: grade.color }} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-slate-100 truncate">{grade.name}</p>
              {grade.is_default === 1 && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-600/20 border border-amber-600/30 text-amber-400 flex-shrink-0">
                  <Star size={8} fill="currentColor" /> Défaut
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              {parentGrade && (
                <>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: parentGrade.color }} />
                  <p className="text-xs text-slate-600">{parentGrade.name}</p>
                  <ChevronRight size={10} className="text-slate-700" />
                </>
              )}
              <p className="text-xs" style={{ color: grade.color }}>{grade.name}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onToggleDefault(grade)}
            title={grade.is_default ? 'Retirer le grade par défaut' : 'Définir comme grade par défaut'}
            className={`p-1.5 rounded-lg transition-colors ${grade.is_default ? 'text-amber-400 bg-amber-600/15' : 'text-slate-600 hover:text-amber-400 hover:bg-amber-600/10'}`}
          >
            <Star size={13} fill={grade.is_default ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => onEdit(grade)}
            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onDelete(grade)}
            className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {grade.permissions.length === 0 ? (
          <span className="text-xs text-slate-700 italic">Aucune permission</span>
        ) : grade.permissions.map(p => {
          const def = ALL_PERMISSIONS.find(x => x.id === p);
          return (
            <span key={p} className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-indigo-600/10 text-indigo-400 border border-indigo-600/20">
              {def?.label || p}
            </span>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <Shield size={10} />
          {grade.user_count} membre{grade.user_count !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

export default function Grades() {
  const { user } = useAuth();
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const canManage = user?.role === 'fondateur' || user?.permissions?.includes('manage_grades');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/grades').then(r => setGrades(r.data)).catch(() => toast.error('Erreur chargement')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data) => {
    const r = await api.post('/grades', data);
    setGrades(prev => [...prev, r.data]);
    toast.success('Grade créé');
  };

  const handleEdit = async (grade, data) => {
    // Update metadata
    await api.patch(`/grades/${grade.id}`, { name: data.name, color: data.color, parent_id: data.parent_id });
    // Update permissions
    await api.put(`/grades/${grade.id}/permissions`, { permissions: data.permissions });
    setGrades(prev => prev.map(g => g.id === grade.id
      ? { ...g, name: data.name, color: data.color, parent_id: data.parent_id, permissions: data.permissions }
      : g
    ));
    toast.success('Grade mis à jour');
  };

  const handleDelete = async (grade) => {
    if (!confirm(`Supprimer le grade "${grade.name}" ? Cette action est irréversible.`)) return;
    try {
      await api.delete(`/grades/${grade.id}`);
      setGrades(prev => prev.filter(g => g.id !== grade.id));
      toast.success('Grade supprimé');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  };

  const handleToggleDefault = async (grade) => {
    try {
      await api.patch(`/grades/${grade.id}`, { is_default: grade.is_default ? 0 : 1 });
      setGrades(prev => prev.map(g => ({
        ...g,
        is_default: g.id === grade.id ? (grade.is_default ? 0 : 1) : 0
      })));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Gestion des grades</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {grades.length} grade{grades.length !== 1 ? 's' : ''} configuré{grades.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {canManage && (
            <button
              onClick={() => setModal({ mode: 'create' })}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              <Plus size={15} /> Nouveau grade
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-600">Chargement...</div>
      ) : grades.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Shield size={36} className="text-slate-700 mx-auto" />
          <p className="text-slate-500">Aucun grade configuré</p>
          {canManage && (
            <button
              onClick={() => setModal({ mode: 'create' })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              <Plus size={14} /> Créer le premier grade
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {grades.map(grade => (
            <GradeCard
              key={grade.id}
              grade={grade}
              grades={grades}
              onEdit={g => setModal({ mode: 'edit', grade: g })}
              onDelete={handleDelete}
              onToggleDefault={handleToggleDefault}
            />
          ))}
        </div>
      )}

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-1.5">
        <p className="text-xs text-slate-500 leading-relaxed">
          <span className="text-indigo-400 font-medium">Hiérarchie</span> — Un grade peut avoir un parent.
          Les membres d'un grade parent voient les tickets visibles par ses grades enfants.
        </p>
        <p className="text-xs text-slate-600">
          <span className="text-amber-400">★ Grade par défaut</span> — Attribué automatiquement lors de la première approbation d'un utilisateur.
        </p>
      </div>

      {modal?.mode === 'create' && (
        <GradeModal
          grade={null}
          grades={grades}
          onClose={() => setModal(null)}
          onSave={handleCreate}
        />
      )}
      {modal?.mode === 'edit' && (
        <GradeModal
          grade={modal.grade}
          grades={grades}
          onClose={() => setModal(null)}
          onSave={data => handleEdit(modal.grade, data)}
        />
      )}
    </div>
  );
}
