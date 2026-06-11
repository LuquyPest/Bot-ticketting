import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, RotateCcw, Loader2, X, Check } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="glass-dark rounded-2xl border border-white/[0.08] p-6 w-full max-w-md shadow-2xl space-y-4">
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

function ManagerForm({ initial, allGuilds, onSubmit, onCancel, loading }) {
  const [username, setUsername]         = useState(initial?.username || '');
  const [password, setPassword]         = useState('');
  const [assignedGuilds, setAssigned]   = useState(initial?.assigned_guilds || []);
  const isEdit = !!initial;

  const toggle = (guildId) => {
    setAssigned(prev => prev.includes(guildId) ? prev.filter(g => g !== guildId) : [...prev, guildId]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { username, assigned_guilds: assignedGuilds };
    if (!isEdit || password) payload.password = password;
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-ink-3">Identifiant</label>
        <input type="text" value={username} onChange={e => setUsername(e.target.value)}
          placeholder="manager01" disabled={isEdit}
          className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]
                     text-sm text-ink-1 placeholder-ink-4 outline-none focus:border-primary/50
                     disabled:opacity-50 transition-colors"
          required={!isEdit}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-ink-3">
          {isEdit ? 'Nouveau mot de passe (laisser vide = inchangé)' : 'Mot de passe'}
        </label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="••••••••" minLength={isEdit ? 0 : 8}
          className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]
                     text-sm text-ink-1 placeholder-ink-4 outline-none focus:border-primary/50 transition-colors"
          required={!isEdit}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-ink-3">Serveurs assignés</label>
        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
          {allGuilds.length === 0 && (
            <p className="text-xs text-ink-4 italic">Aucun serveur actif</p>
          )}
          {allGuilds.map(g => (
            <button key={g.guild_id} type="button" onClick={() => toggle(g.guild_id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs
                         transition-all ${assignedGuilds.includes(g.guild_id)
                           ? 'bg-primary/10 text-ink-1 border border-primary/20'
                           : 'text-ink-3 hover:bg-white/[0.04] border border-transparent'}`}>
              {assignedGuilds.includes(g.guild_id)
                ? <Check size={12} className="text-primary-light flex-shrink-0" />
                : <div className="w-3 h-3 rounded border border-white/[0.15] flex-shrink-0" />
              }
              <span className="truncate">{g.guild_name}</span>
              <span className="ml-auto text-[10px] text-ink-4 font-mono flex-shrink-0">{g.guild_id}</span>
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
                     hover:bg-primary-light disabled:opacity-60 transition-all
                     flex items-center gap-2">
          {loading && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? 'Enregistrer' : 'Créer'}
        </button>
      </div>
    </form>
  );
}

export default function SAManagers() {
  const [managers, setManagers] = useState([]);
  const [guilds, setGuilds]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null); // 'add' | { edit: manager }
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [resetingId, setResetingId] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/sa/managers'),
      api.get('/sa/guilds')
    ]).then(([mr, gr]) => {
      setManagers(mr.data);
      setGuilds(gr.data.filter(g => g.status === 'active'));
    }).catch(() => toast.error('Erreur chargement')).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (payload) => {
    setSubmitting(true);
    try {
      await api.post('/sa/managers', payload);
      toast.success('Manager créé');
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
      await api.patch(`/sa/managers/${modal.edit.id}`, payload);
      toast.success('Manager mis à jour');
      setModal(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
    setSubmitting(false);
  };

  const handleDelete = async (mgr) => {
    if (!window.confirm(`Supprimer le manager ${mgr.username} ?`)) return;
    setDeletingId(mgr.id);
    try {
      await api.delete(`/sa/managers/${mgr.id}`);
      toast.success('Manager supprimé');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
    setDeletingId(null);
  };

  const handleResetTotp = async (mgr) => {
    if (!window.confirm(`Réinitialiser le 2FA de ${mgr.username} ?`)) return;
    setResetingId(mgr.id);
    try {
      await api.post(`/sa/managers/${mgr.id}/reset-totp`);
      toast.success('2FA réinitialisé');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
    setResetingId(null);
  };

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {modal === 'add' && (
        <Modal title="Nouveau manager" onClose={() => setModal(null)}>
          <ManagerForm allGuilds={guilds} onSubmit={handleAdd} onCancel={() => setModal(null)} loading={submitting} />
        </Modal>
      )}
      {modal?.edit && (
        <Modal title={`Modifier — ${modal.edit.username}`} onClose={() => setModal(null)}>
          <ManagerForm initial={modal.edit} allGuilds={guilds} onSubmit={handleEdit} onCancel={() => setModal(null)} loading={submitting} />
        </Modal>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink-1">Managers</h1>
          <p className="text-sm text-ink-3">{managers.length} manager(s)</p>
        </div>
        <button onClick={() => setModal('add')}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
                     bg-primary hover:bg-primary-light text-white transition-all">
          <Plus size={14} />
          Nouveau manager
        </button>
      </div>

      <div className="glass-dark rounded-2xl border border-white/[0.08] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-primary-light" />
          </div>
        ) : managers.length === 0 ? (
          <div className="py-16 text-center text-sm text-ink-3">Aucun manager</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['Manager', 'Serveurs assignés', 'Créé le', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-ink-4 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {managers.map(mgr => (
                <tr key={mgr.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600
                                      flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                        {mgr.username[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-ink-1">{mgr.username}</p>
                        <p className="text-[10px] text-ink-4">ID #{mgr.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(mgr.assigned_guilds?.length ? mgr.assigned_guilds : []).map(gId => {
                        const g = guilds.find(x => x.guild_id === gId);
                        return (
                          <span key={gId}
                            className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.06]
                                       border border-white/[0.08] text-ink-3">
                            {g?.guild_name || gId}
                          </span>
                        );
                      })}
                      {!mgr.assigned_guilds?.length && (
                        <span className="text-[10px] text-ink-4 italic">Aucun</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-3">
                    {mgr.created_at ? new Date(mgr.created_at).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setModal({ edit: mgr })} title="Modifier"
                        className="p-1.5 rounded-lg text-ink-4 hover:text-primary-light hover:bg-primary/10 transition-all">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleResetTotp(mgr)} title="Réinitialiser 2FA"
                        disabled={resetingId === mgr.id}
                        className="p-1.5 rounded-lg text-ink-4 hover:text-amber-400 hover:bg-amber-400/10 transition-all
                                   disabled:opacity-50">
                        {resetingId === mgr.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : <RotateCcw size={13} />
                        }
                      </button>
                      <button onClick={() => handleDelete(mgr)} title="Supprimer"
                        disabled={deletingId === mgr.id}
                        className="p-1.5 rounded-lg text-ink-4 hover:text-red-400 hover:bg-red-400/10 transition-all
                                   disabled:opacity-50">
                        {deletingId === mgr.id
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
