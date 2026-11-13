import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, UserCog } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../utils/confirmToast';

const PRESET_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316',
  '#eab308','#22c55e','#14b8a6','#3b82f6','#64748b'
];

const selectCls = 'bg-surface border border-overlay/8 text-ink-2 rounded-lg px-2 py-1 text-xs focus:outline-hidden focus:border-primary/50';

function Chip({ color, children, onRemove, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium border border-overlay/8 bg-overlay/4 text-ink-1"
      style={color ? { borderColor: `${color}60` } : undefined}>
      {color && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
      {children}
      <button onClick={onRemove} aria-label={label} className="opacity-60 hover:opacity-100"><X size={11} /></button>
    </span>
  );
}

function RoleModal({ role, onClose, onSave }) {
  const [name, setName] = useState(role?.name || '');
  const [color, setColor] = useState(role?.color || '#6366f1');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ name: name.trim(), color }); onClose(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="role-modal-title"
        className="bg-surface-card border border-overlay/8 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="role-modal-title" className="text-sm font-semibold text-ink-1">{role ? 'Modifier le rôle' : 'Nouveau rôle'}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-ink-3 hover:text-ink-2"><X size={16} /></button>
        </div>
        <div>
          <label htmlFor="role-name" className="text-xs text-ink-3 mb-1.5 block">Nom</label>
          <input id="role-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} autoFocus
            className="w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary" />
        </div>
        <div>
          <span className="text-xs text-ink-3 mb-1.5 block">Couleur</span>
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_COLORS.map(c => (
              <button type="button" key={c} onClick={() => setColor(c)} aria-label={c}
                className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
            <input type="color" value={color} onChange={e => setColor(e.target.value)} aria-label="Autre couleur"
              className="w-7 h-7 rounded-full cursor-pointer bg-transparent border-0 p-0" />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg bg-surface text-ink-2 text-sm hover:bg-surface-hover transition-colors">Annuler</button>
          <button type="submit" disabled={saving || !name.trim()}
            className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50">
            {role ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Roles() {
  const [roles, setRoles] = useState([]);
  const [staff, setStaff] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.get('/roles'), api.get('/users'), api.get('/tags')])
      .then(([r, u, t]) => {
        setRoles(r.data);
        setStaff(u.data.filter(x => x.role === 'support'));
        setTags(t.data);
      })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const patchRole = (id, data) => setRoles(prev => prev.map(r => (r.id === id ? { ...r, ...data } : r)));

  const create = async (data) => {
    const { data: role } = await api.post('/roles', data);
    setRoles(prev => [...prev, role]);
    toast.success('Rôle créé');
  };
  const update = async (role, data) => {
    await api.patch(`/roles/${role.id}`, data);
    patchRole(role.id, data);
    toast.success('Rôle modifié');
  };
  const remove = async (role) => {
    if (!await confirmToast(`Supprimer le rôle « ${role.name} » ?`)) return;
    try {
      await api.delete(`/roles/${role.id}`);
      setRoles(prev => prev.filter(r => r.id !== role.id));
      toast.success('Rôle supprimé');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  const setMembers = async (role, userIds) => {
    try {
      await api.put(`/roles/${role.id}/members`, { userIds });
      patchRole(role.id, { members: staff.filter(s => userIds.includes(s.user_id)).map(s => ({ user_id: s.user_id, username: s.username, avatar: s.avatar })) });
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const setRoleTags = async (role, tagIds) => {
    try {
      await api.put(`/roles/${role.id}/tags`, { tagIds });
      patchRole(role.id, { tags: tags.filter(t => tagIds.includes(t.id)) });
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  return (
    <div className="p-6 space-y-5">
      {modal?.mode === 'create' && <RoleModal role={null} onClose={() => setModal(null)} onSave={create} />}
      {modal?.mode === 'edit' && <RoleModal role={modal.role} onClose={() => setModal(null)} onSave={data => update(modal.role, data)} />}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <UserCog size={20} className="text-primary-light" />
          <h1 className="text-xl font-bold text-ink-1">Rôles</h1>
        </div>
        <button onClick={() => setModal({ mode: 'create' })}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
          <Plus size={14} /> Nouveau rôle
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-ink-4 text-sm">Chargement...</div>
      ) : roles.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <UserCog size={36} className="text-ink-4 mx-auto" />
          <p className="text-ink-3 text-sm">Aucun rôle</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {roles.map(role => {
            const memberIds = role.members.map(m => m.user_id);
            const tagIds = role.tags.map(t => t.id);
            const freeStaff = staff.filter(s => !memberIds.includes(s.user_id));
            const freeTags = tags.filter(t => !tagIds.includes(t.id));
            return (
              <div key={role.id} className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                  <h2 className="flex-1 min-w-0 truncate text-sm font-semibold text-ink-1">{role.name}</h2>
                  <button onClick={() => setModal({ mode: 'edit', role })} aria-label={`Modifier ${role.name}`}
                    className="p-1.5 rounded-lg text-ink-4 hover:text-ink-2 hover:bg-overlay/6"><Pencil size={13} /></button>
                  <button onClick={() => remove(role)} aria-label={`Supprimer ${role.name}`}
                    className="p-1.5 rounded-lg text-ink-4 hover:text-red-400 hover:bg-red-400/10"><Trash2 size={13} /></button>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">Membres ({role.members.length})</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {role.members.map(m => (
                      <Chip key={m.user_id} label={`Retirer ${m.username}`} onRemove={() => setMembers(role, memberIds.filter(id => id !== m.user_id))}>
                        {m.avatar
                          ? <img src={`https://cdn.discordapp.com/avatars/${m.user_id}/${m.avatar}.webp?size=32`} alt="" className="w-4 h-4 rounded-full" />
                          : null}
                        <span className="text-ink-2" translate="no">{m.username}</span>
                      </Chip>
                    ))}
                    {freeStaff.length > 0 && (
                      <select value="" onChange={e => e.target.value && setMembers(role, [...memberIds, e.target.value])}
                        aria-label={`Ajouter un membre à ${role.name}`} className={selectCls}>
                        <option value="">+ Ajouter</option>
                        {freeStaff.map(s => <option key={s.user_id} value={s.user_id}>{s.username}</option>)}
                      </select>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">Tags ({role.tags.length})</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {role.tags.map(t => (
                      <Chip key={t.id} color={t.color} label={`Retirer ${t.name}`} onRemove={() => setRoleTags(role, tagIds.filter(id => id !== t.id))}>
                        {t.name}
                      </Chip>
                    ))}
                    {freeTags.length > 0 && (
                      <select value="" onChange={e => e.target.value && setRoleTags(role, [...tagIds, Number(e.target.value)])}
                        aria-label={`Rattacher un tag à ${role.name}`} className={selectCls}>
                        <option value="">+ Ajouter</option>
                        {freeTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
