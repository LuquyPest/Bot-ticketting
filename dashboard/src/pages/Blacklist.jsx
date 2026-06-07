import React, { useEffect, useState } from 'react';
import { ShieldBan, Plus, Trash2, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { fmtDate } from '../utils/format';

const DURATIONS = [
  { value: '1d',        label: '1 jour' },
  { value: '7d',        label: '7 jours' },
  { value: '30d',       label: '30 jours' },
  { value: 'permanent', label: 'Permanent' }
];

function AddModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ userId: '', userTag: '', reason: '', duration: 'permanent' });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.userId || !form.userTag) return toast.error('ID et tag requis');
    setLoading(true);
    try {
      await api.post('/blacklist', form);
      toast.success('Utilisateur banni');
      onAdded();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-100">Ajouter à la blacklist</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">User ID Discord *</label>
            <input type="text" value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))} placeholder="123456789012345678"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Username *</label>
            <input type="text" value={form.userTag} onChange={e => setForm(f => ({ ...f, userTag: e.target.value }))} placeholder="user#0000"
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Raison (optionnel)</label>
            <input type="text" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Spam, abus..."
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Durée</label>
            <div className="grid grid-cols-4 gap-1">
              {DURATIONS.map(d => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, duration: d.value }))}
                  className={`py-1.5 rounded-lg text-xs font-medium border transition-colors ${form.duration === d.value
                    ? 'bg-red-600/20 border-red-600/50 text-red-400'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg bg-slate-800 text-slate-400 text-sm hover:bg-slate-700 transition-colors">Annuler</button>
            <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-500 transition-colors disabled:opacity-50">
              {loading ? 'Ajout...' : 'Bannir'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Blacklist() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/blacklist').then(r => setList(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const remove = async (userId, tag) => {
    if (!confirm(`Retirer ${tag} de la blacklist ?`)) return;
    try {
      await api.delete(`/blacklist/${userId}`);
      setList(l => l.filter(u => u.user_id !== userId));
      toast.success('Retiré de la blacklist');
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  };

  return (
    <div className="p-6 space-y-5">
      {showModal && <AddModal onClose={() => setShowModal(false)} onAdded={load} />}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Blacklist</h1>
          <p className="text-sm text-slate-500 mt-0.5">{list.length} utilisateur(s) banni(s)</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
        >
          <Plus size={15} /> Ajouter
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Utilisateur</th>
              <th className="text-left px-4 py-3 font-medium">Raison</th>
              <th className="text-left px-4 py-3 font-medium">Banni par</th>
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Expire</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-10 text-slate-600">Chargement...</td></tr>
            ) : !list.length ? (
              <tr><td colSpan={6} className="text-center py-10 text-slate-600">Blacklist vide</td></tr>
            ) : list.map(u => (
              <tr key={u.user_id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30 transition-colors">
                <td className="px-4 py-3">
                  <p className="text-slate-200 font-medium">{u.user_tag}</p>
                  <p className="text-xs text-slate-600 font-mono">{u.user_id}</p>
                </td>
                <td className="px-4 py-3 text-slate-400 max-w-xs">{u.reason || <span className="italic text-slate-600">—</span>}</td>
                <td className="px-4 py-3 text-slate-400">{u.added_by_tag}</td>
                <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(u.added_at)}</td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">
                  {u.expires_at
                    ? <span className="text-amber-400">{fmtDate(u.expires_at)}</span>
                    : <span className="text-slate-600 italic">Permanent</span>}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => remove(u.user_id, u.user_tag)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-600/10 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
