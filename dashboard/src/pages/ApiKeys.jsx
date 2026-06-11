import React, { useEffect, useState } from 'react';
import { Key, Plus, Trash2, Copy, Check, Loader2, RefreshCw, ShieldOff } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const PERM_LABELS = {
  read_tickets: 'Lire les tickets',
  create_tickets: 'Créer des tickets',
  close_tickets: 'Fermer des tickets',
  read_stats: 'Lire les statistiques',
};

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} title="Copier"
      className="p-1 rounded text-ink-4 hover:text-ink-1 transition-colors">
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
    </button>
  );
}

export default function ApiKeys() {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(false);
  const [newKey, setNewKey]       = useState(null); // shown once after creation
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState({ name: '', permissions: [], expiresAt: '' });
  const [deleting, setDeleting]   = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/api-keys').then(r => setData(r.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    if (!form.name.trim()) return toast.error('Nom requis');
    setCreating(true);
    try {
      const r = await api.post('/api-keys', {
        name: form.name.trim(),
        permissions: form.permissions,
        expiresAt: form.expiresAt || null,
      });
      setNewKey(r.data);
      setShowForm(false);
      setForm({ name: '', permissions: [], expiresAt: '' });
      load();
      toast.success('Clé API créée — sauvegarde-la maintenant, elle ne sera plus affichée !');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id) => {
    setDeleting(id);
    try {
      await api.delete(`/api-keys/${id}`);
      toast.success('Clé révoquée');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setDeleting(null);
    }
  };

  const togglePerm = (p) => setForm(f => ({
    ...f,
    permissions: f.permissions.includes(p) ? f.permissions.filter(x => x !== p) : [...f.permissions, p]
  }));

  if (loading) return <div className="p-6 text-ink-3">Chargement...</div>;
  if (!data?.enabled) return (
    <div className="p-6 max-w-xl">
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-300">
        L'API publique n'est pas activée pour ce serveur. Active-la dans les Paramètres → Fonctionnalités.
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Clés API</h1>
          <p className="text-sm text-ink-3 mt-0.5">Accès externe sécurisé par clé pour intégrations tierces</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 text-ink-3 hover:text-ink-1 hover:bg-surface rounded-lg transition-colors">
            <RefreshCw size={15} />
          </button>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary hover:bg-primary-light
                       text-white text-sm font-medium transition-colors">
            <Plus size={14} />
            Nouvelle clé
          </button>
        </div>
      </div>

      {/* New key reveal */}
      {newKey && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-emerald-300">Clé créée — copie-la maintenant !</p>
          <p className="text-xs text-emerald-400/70">Elle ne sera plus affichée après rechargement de la page.</p>
          <div className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2 font-mono text-xs text-emerald-300">
            <span className="flex-1 break-all">{newKey.key}</span>
            <CopyButton text={newKey.key} />
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-ink-4 hover:text-ink-2 transition-colors">
            J'ai sauvegardé ma clé
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-ink-2">Nouvelle clé API</h3>
          <div>
            <label className="text-xs text-ink-3 block mb-1">Nom de la clé</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="ex: Mon intégration webhook" maxLength={100}
              className="w-full bg-surface border border-white/[0.08] text-ink-1 rounded-lg px-3 py-2
                         text-sm focus:outline-none focus:border-primary transition-colors" />
          </div>
          <div>
            <label className="text-xs text-ink-3 block mb-1.5">Permissions</label>
            <div className="space-y-1.5">
              {Object.entries(PERM_LABELS).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={form.permissions.includes(k)} onChange={() => togglePerm(k)}
                    className="accent-primary" />
                  <span className="text-sm text-ink-2">{label}</span>
                  <span className="text-[10px] font-mono text-ink-4">{k}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-ink-3 block mb-1">Expiration (optionnel)</label>
            <input type="datetime-local" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
              className="bg-surface border border-white/[0.08] text-ink-1 rounded-lg px-3 py-2
                         text-sm focus:outline-none focus:border-primary transition-colors" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)}
              className="flex-1 py-2 rounded-lg text-sm text-ink-3 hover:text-ink-1 hover:bg-surface transition-all">
              Annuler
            </button>
            <button onClick={create} disabled={creating || !form.name.trim()}
              className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-primary
                         hover:bg-primary-light disabled:opacity-60 transition-all flex items-center justify-center gap-2">
              {creating ? <Loader2 size={13} className="animate-spin" /> : <Key size={13} />}
              Créer
            </button>
          </div>
        </div>
      )}

      {/* Keys list */}
      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
        {data.keys.length === 0 ? (
          <p className="text-sm text-ink-4 text-center py-10">Aucune clé API créée</p>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {data.keys.map(k => {
              let perms = [];
              try { perms = Array.isArray(k.permissions) ? k.permissions : JSON.parse(k.permissions || '[]'); } catch {}
              return (
                <div key={k.id} className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                  <Key size={14} className={k.active ? 'text-primary-light' : 'text-ink-4'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-1 flex items-center gap-2">
                      {k.name}
                      {!k.active && <ShieldOff size={11} className="text-red-400" title="Révoquée" />}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-mono text-[10px] text-ink-4">{k.key_prefix}…</span>
                      <span className="text-[10px] text-ink-4">{perms.join(', ') || 'aucune permission'}</span>
                    </div>
                    {k.last_used_at && (
                      <p className="text-[10px] text-ink-4 mt-0.5">
                        Dernière utilisation : {new Date(k.last_used_at).toLocaleString('fr-FR')}
                      </p>
                    )}
                  </div>
                  {k.active && (
                    <button onClick={() => revoke(k.id)} disabled={deleting === k.id}
                      className="p-1.5 text-ink-4 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all">
                      {deleting === k.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
