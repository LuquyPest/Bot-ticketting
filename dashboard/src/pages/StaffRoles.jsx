import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Check, Loader2, ShieldCheck } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const ALL_PERMS = [
  { key: 'manage_tickets',     label: 'Gérer les tickets',         hint: 'Claim, fermeture, déplacement' },
  { key: 'close_others',       label: 'Fermer les tickets des autres', hint: 'Fermer des tickets non assignés à soi' },
  { key: 'view_all_tickets',   label: 'Voir tous les tickets',     hint: 'Accès aux tickets non assignés' },
  { key: 'manage_grades',      label: 'Gérer les grades',          hint: 'Créer et modifier les grades staff' },
  { key: 'manage_settings',    label: 'Gérer les paramètres',      hint: 'Accès à la page Paramètres' },
  { key: 'view_audit',         label: 'Voir le journal d\'audit',  hint: 'Accès aux logs d\'actions' },
];

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="glass-dark rounded-2xl border border-white/[0.08] p-6 w-full max-w-md shadow-2xl space-y-5
                      max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-1">{title}</h2>
          <button onClick={onClose} className="text-ink-4 hover:text-ink-1 p-1 rounded-lg hover:bg-white/[0.05]">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RoleForm({ initial, allRoles, onSubmit, onCancel, loading }) {
  const [name, setName]         = useState(initial?.name || '');
  const [color, setColor]       = useState(initial?.color || '#6366f1');
  const [level, setLevel]       = useState(initial?.level ?? 1);
  const [isFounder, setFounder] = useState(!!initial?.is_founder_role);
  const [discRoles, setDiscRoles] = useState(initial?.discord_role_ids || []);
  const [perms, setPerms]       = useState(initial?.permissions || []);

  const toggleRole = (id) => setDiscRoles(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const togglePerm = (k) => setPerms(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ name, color, level, is_founder_role: isFounder ? 1 : 0, discord_role_ids: discRoles, permissions: perms });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name + color */}
      <div className="flex gap-3">
        <div className="flex-1 space-y-1.5">
          <label className="text-xs font-medium text-ink-3">Nom du rôle</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} required
            maxLength={80} placeholder="Support Senior"
            className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]
                       text-sm text-ink-1 placeholder-ink-4 outline-none focus:border-primary/50 transition-colors" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-ink-3">Couleur</label>
          <div className="flex items-center gap-2">
            <input type="color" value={color} onChange={e => setColor(e.target.value)}
              className="w-10 h-[42px] rounded-xl border border-white/[0.08] bg-transparent cursor-pointer p-0.5" />
            <input type="text" value={color} onChange={e => setColor(e.target.value)}
              pattern="^#[0-9a-fA-F]{6}$"
              className="w-24 px-2 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]
                         text-xs font-mono text-ink-1 outline-none focus:border-primary/50 transition-colors" />
          </div>
        </div>
      </div>

      {/* Level */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-ink-3">Niveau hiérarchique (1 = bas, 10 = haut)</label>
        <input type="number" min={1} max={10} value={level} onChange={e => setLevel(parseInt(e.target.value))}
          className="w-20 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]
                     text-sm text-ink-1 outline-none focus:border-primary/50 transition-colors" />
      </div>

      {/* Founder toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div onClick={() => setFounder(f => !f)}
          className={`w-10 h-5 rounded-full transition-colors flex-shrink-0
                     ${isFounder ? 'bg-primary' : 'bg-white/[0.1]'}`}>
          <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-transform
                          ${isFounder ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </div>
        <div>
          <p className="text-sm text-ink-2 font-medium">Rôle fondateur</p>
          <p className="text-xs text-ink-4">Accès total — équivalent propriétaire du bot</p>
        </div>
      </label>

      {/* Discord roles */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-ink-3">Rôles Discord liés</label>
        {allRoles.length === 0 ? (
          <p className="text-xs text-ink-4 italic py-1">Bot Discord non disponible</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {allRoles.map(r => (
              <button key={r.id} type="button" onClick={() => toggleRole(r.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all
                           ${discRoles.includes(r.id)
                             ? 'bg-primary/10 border border-primary/20 text-ink-1'
                             : 'text-ink-3 hover:bg-white/[0.04] border border-transparent'}`}>
                {discRoles.includes(r.id)
                  ? <Check size={12} className="text-primary-light flex-shrink-0" />
                  : <div className="w-3 h-3 rounded border border-white/[0.15] flex-shrink-0" />
                }
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: r.color && r.color !== '#000000' ? r.color : '#6366f1' }} />
                <span className="truncate">{r.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Permissions */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-ink-3">Permissions dashboard</label>
        <div className="space-y-1">
          {ALL_PERMS.map(p => (
            <button key={p.key} type="button" onClick={() => togglePerm(p.key)}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-xs transition-all text-left
                         ${perms.includes(p.key)
                           ? 'bg-primary/10 border border-primary/20 text-ink-1'
                           : 'text-ink-3 hover:bg-white/[0.04] border border-transparent'}`}>
              <div className="mt-0.5 flex-shrink-0">
                {perms.includes(p.key)
                  ? <Check size={12} className="text-primary-light" />
                  : <div className="w-3 h-3 rounded border border-white/[0.15]" />
                }
              </div>
              <div>
                <p className="font-medium">{p.label}</p>
                <p className="text-ink-4 text-[10px] mt-0.5">{p.hint}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1 hover:bg-white/[0.05] transition-all">
          Annuler
        </button>
        <button type="submit" disabled={loading}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary
                     hover:bg-primary-light disabled:opacity-60 transition-all flex items-center gap-2">
          {loading && <Loader2 size={14} className="animate-spin" />}
          {initial ? 'Enregistrer' : 'Créer'}
        </button>
      </div>
    </form>
  );
}

export default function StaffRoles() {
  const [roles, setRoles]         = useState([]);
  const [discRoles, setDiscRoles] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(null); // 'add' | { edit: role }
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/staff-roles'),
      api.get('/discord/roles').catch(() => ({ data: [] })),
    ]).then(([r, dr]) => {
      setRoles(r.data);
      setDiscRoles(dr.data);
    }).catch(() => toast.error('Erreur chargement')).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (payload) => {
    setSubmitting(true);
    try {
      await api.post('/staff-roles', payload);
      toast.success('Rôle créé');
      setModal(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
    setSubmitting(false);
  };

  const handleEdit = async (payload) => {
    setSubmitting(true);
    try {
      await api.patch(`/staff-roles/${modal.edit.id}`, payload);
      toast.success('Rôle mis à jour');
      setModal(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
    setSubmitting(false);
  };

  const handleDelete = async (role) => {
    if (!window.confirm(`Supprimer le rôle "${role.name}" ?`)) return;
    setDeletingId(role.id);
    try {
      await api.delete(`/staff-roles/${role.id}`);
      toast.success('Rôle supprimé');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
    setDeletingId(null);
  };

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {modal === 'add' && (
        <Modal title="Nouveau rôle staff" onClose={() => setModal(null)}>
          <RoleForm allRoles={discRoles} onSubmit={handleAdd} onCancel={() => setModal(null)} loading={submitting} />
        </Modal>
      )}
      {modal?.edit && (
        <Modal title={`Modifier — ${modal.edit.name}`} onClose={() => setModal(null)}>
          <RoleForm initial={modal.edit} allRoles={discRoles} onSubmit={handleEdit} onCancel={() => setModal(null)} loading={submitting} />
        </Modal>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Rôles staff</h1>
          <p className="text-sm text-ink-3 mt-0.5">Rôles personnalisés avec niveaux et permissions dashboard</p>
        </div>
        <button onClick={() => setModal('add')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-light
                     text-white text-sm font-medium transition-colors">
          <Plus size={14} />
          Nouveau rôle
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-primary-light" />
          </div>
        ) : roles.length === 0 ? (
          <div className="py-16 text-center">
            <ShieldCheck size={32} className="mx-auto text-ink-4 mb-3" />
            <p className="text-sm text-ink-3">Aucun rôle staff configuré</p>
            <p className="text-xs text-ink-4 mt-1">Créez des rôles pour affiner les permissions de votre équipe</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['Rôle', 'Niveau', 'Rôles Discord', 'Permissions', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-ink-4 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {roles.map(role => (
                <tr key={role.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: role.color || '#6366f1' }} />
                      <div>
                        <p className="text-sm font-semibold text-ink-1">{role.name}</p>
                        {!!role.is_founder_role && (
                          <span className="text-[10px] text-amber-400 font-medium">Fondateur</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono font-bold text-ink-2 px-2 py-0.5 rounded-lg
                                     bg-white/[0.05] border border-white/[0.08]">
                      Niv. {role.level}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(role.discord_role_ids?.length ? role.discord_role_ids : []).map(rId => {
                        const dr = discRoles.find(x => x.id === rId);
                        return (
                          <span key={rId} className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.06]
                                                      border border-white/[0.08] text-ink-3"
                            style={{ borderColor: dr?.color && dr.color !== '#000000' ? dr.color + '40' : undefined }}>
                            {dr?.name || rId}
                          </span>
                        );
                      })}
                      {!role.discord_role_ids?.length && (
                        <span className="text-[10px] text-ink-4 italic">Aucun</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {role.permissions?.map(p => {
                        const def = ALL_PERMS.find(x => x.key === p);
                        return (
                          <span key={p} className="text-[10px] px-1.5 py-0.5 rounded-md
                                                    bg-primary/10 border border-primary/20 text-primary-light">
                            {def?.label || p}
                          </span>
                        );
                      })}
                      {!role.permissions?.length && (
                        <span className="text-[10px] text-ink-4 italic">Aucune</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setModal({ edit: role })} title="Modifier"
                        className="p-1.5 rounded-lg text-ink-4 hover:text-primary-light hover:bg-primary/10 transition-all">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDelete(role)} title="Supprimer"
                        disabled={deletingId === role.id}
                        className="p-1.5 rounded-lg text-ink-4 hover:text-red-400 hover:bg-red-400/10
                                   transition-all disabled:opacity-50">
                        {deletingId === role.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Trash2 size={13} />
                        }
                      </button>
                    </div>
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
