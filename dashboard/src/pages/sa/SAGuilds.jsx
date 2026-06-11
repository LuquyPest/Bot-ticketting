import React, { useEffect, useState } from 'react';
import {
  Building2, CheckCircle, Clock, XCircle, RefreshCw,
  Trash2, Play, Pause, Search, Loader2, AlertTriangle, WrenchIcon
} from 'lucide-react';
import api from '../../api';
import { useSA } from './SAApp';
import toast from 'react-hot-toast';

const STATUS = {
  active:    { label: 'Actif',    cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle },
  pending:   { label: 'En attente', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20',     icon: Clock },
  suspended: { label: 'Suspendu', cls: 'text-red-300 bg-red-500/10 border-red-500/20',             icon: XCircle },
};

const TABS = ['all', 'pending', 'active', 'suspended'];
const TAB_LABEL = { all: 'Tous', pending: 'En attente', active: 'Actifs', suspended: 'Suspendus' };

function GuildIcon({ guild }) {
  const [err, setErr] = useState(false);
  if (guild.guild_icon && !err) {
    return (
      <img
        src={`https://cdn.discordapp.com/icons/${guild.guild_id}/${guild.guild_icon}.webp?size=32`}
        alt="" className="w-8 h-8 rounded-lg ring-1 ring-white/10 object-cover flex-shrink-0"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600
                    flex items-center justify-center flex-shrink-0">
      <Building2 size={13} className="text-white" />
    </div>
  );
}

function ConfirmModal({ message, onConfirm, onCancel, danger }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="glass-dark rounded-2xl border border-white/[0.08] p-6 w-full max-w-sm space-y-4
                      shadow-2xl">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className={danger ? 'text-red-400 flex-shrink-0 mt-0.5' : 'text-amber-400 flex-shrink-0 mt-0.5'} />
          <p className="text-sm text-ink-2">{message}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1
                       hover:bg-white/[0.05] transition-all">
            Annuler
          </button>
          <button onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all
                       ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-amber-600 hover:bg-amber-500'}`}>
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SAGuilds() {
  const { saUser } = useSA();
  const isSA = saUser?.type === 'superadmin';

  const [guilds, setGuilds]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [tab, setTab]             = useState('all');
  const [confirm, setConfirm]     = useState(null); // { action, guild }
  const [actioning, setActioning] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/sa/guilds').then(r => setGuilds(r.data)).catch(() => toast.error('Erreur chargement')).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = guilds.filter(g => {
    const matchTab = tab === 'all' || g.status === tab;
    const matchSearch = !search || g.guild_name.toLowerCase().includes(search.toLowerCase()) || g.guild_id.includes(search);
    return matchTab && matchSearch;
  });

  const counts = TABS.reduce((acc, t) => {
    acc[t] = t === 'all' ? guilds.length : guilds.filter(g => g.status === t).length;
    return acc;
  }, {});

  const doAction = async (action, guild) => {
    setConfirm(null);
    setActioning(guild.guild_id + action);
    try {
      if (action === 'approve') {
        await api.post(`/sa/guilds/${guild.guild_id}/approve`);
        toast.success(`${guild.guild_name} activé`);
      } else if (action === 'suspend') {
        await api.patch(`/sa/guilds/${guild.guild_id}/suspend`);
        toast.success(`${guild.guild_name} suspendu`);
      } else if (action === 'reactivate') {
        await api.patch(`/sa/guilds/${guild.guild_id}/reactivate`);
        toast.success(`${guild.guild_name} réactivé`);
      } else if (action === 'delete') {
        await api.delete(`/sa/guilds/${guild.guild_id}`);
        toast.success(`${guild.guild_name} supprimé`);
      } else if (action === 'maintenance_on') {
        await api.patch(`/sa/guilds/${guild.guild_id}/maintenance`, { enabled: true });
        toast.success(`Mode maintenance activé pour ${guild.guild_name}`);
      } else if (action === 'maintenance_off') {
        await api.patch(`/sa/guilds/${guild.guild_id}/maintenance`, { enabled: false });
        toast.success(`Mode maintenance désactivé pour ${guild.guild_name}`);
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
    setActioning(null);
  };

  const askConfirm = (action, guild) => setConfirm({ action, guild });

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      {confirm && (
        <ConfirmModal
          message={
            confirm.action === 'delete'
              ? `Supprimer définitivement ${confirm.guild.guild_name} et toute sa base de données ?`
              : confirm.action === 'suspend'
              ? `Suspendre le serveur ${confirm.guild.guild_name} ?`
              : `Réactiver le serveur ${confirm.guild.guild_name} ?`
          }
          danger={confirm.action === 'delete'}
          onConfirm={() => doAction(confirm.action, confirm.guild)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink-1">Serveurs</h1>
          <p className="text-sm text-ink-3">{guilds.length} serveur(s) enregistré(s)</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-ink-3
                     hover:text-ink-1 hover:bg-white/[0.05] transition-all border border-white/[0.06]">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualiser
        </button>
      </div>

      {/* Tabs + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                         ${tab === t ? 'bg-primary/15 text-ink-1' : 'text-ink-4 hover:text-ink-2'}`}>
              {TAB_LABEL[t]}
              {counts[t] > 0 && (
                <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full
                                 ${tab === t ? 'bg-primary/20 text-primary-light' : 'bg-white/[0.06] text-ink-4'}`}>
                  {counts[t]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06]
                        flex-1 max-w-xs">
          <Search size={13} className="text-ink-4 flex-shrink-0" />
          <input type="text" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-xs text-ink-1 placeholder-ink-4 outline-none" />
        </div>
      </div>

      {/* Table */}
      <div className="glass-dark rounded-2xl border border-white/[0.08] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-primary-light" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-ink-3">Aucun serveur trouvé</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Serveur', 'Propriétaire', 'Statut', 'Membres', 'Créé le', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-ink-4 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.map(guild => {
                  const st = STATUS[guild.status] || STATUS.pending;
                  const Icon = st.icon;
                  const isActioning = actioning?.startsWith(guild.guild_id);
                  return (
                    <tr key={guild.guild_id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <GuildIcon guild={guild} />
                          <div>
                            <p className="text-sm font-semibold text-ink-1 leading-tight">{guild.guild_name}</p>
                            <p className="text-[10px] text-ink-4 font-mono">{guild.guild_id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-ink-2">{guild.owner_discord_tag}</p>
                        <p className="text-[10px] text-ink-4 font-mono">{guild.owner_discord_id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold
                                           px-2 py-1 rounded-full border ${st.cls}`}>
                            <Icon size={11} />
                            {st.label}
                          </span>
                          {!!guild.maintenance_mode && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold
                                             px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/25
                                             text-orange-300">
                              <WrenchIcon size={9} />
                              Maintenance
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-3 tabular-nums">
                        {guild.member_count?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-3">
                        {guild.created_at ? new Date(guild.created_at).toLocaleDateString('fr-FR') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {isSA && (
                          <div className="flex items-center gap-1.5">
                            {isActioning ? (
                              <Loader2 size={14} className="animate-spin text-ink-3" />
                            ) : (
                              <>
                                {guild.status === 'pending' && (
                                  <ActionBtn
                                    icon={Play} label="Approuver"
                                    cls="text-emerald-400 hover:bg-emerald-400/10"
                                    onClick={() => askConfirm('approve', guild)}
                                  />
                                )}
                                {guild.status === 'active' && (
                                  <ActionBtn
                                    icon={Pause} label="Suspendre"
                                    cls="text-amber-400 hover:bg-amber-400/10"
                                    onClick={() => askConfirm('suspend', guild)}
                                  />
                                )}
                                {guild.status === 'suspended' && (
                                  <ActionBtn
                                    icon={Play} label="Réactiver"
                                    cls="text-emerald-400 hover:bg-emerald-400/10"
                                    onClick={() => askConfirm('reactivate', guild)}
                                  />
                                )}
                                <ActionBtn
                                  icon={WrenchIcon}
                                  label={guild.maintenance_mode ? 'Désactiver maintenance' : 'Mode maintenance'}
                                  cls={guild.maintenance_mode ? 'text-orange-400 hover:bg-orange-400/10 ring-1 ring-orange-400/30' : 'text-ink-3 hover:bg-amber-400/10 hover:text-amber-400'}
                                  onClick={() => doAction(guild.maintenance_mode ? 'maintenance_off' : 'maintenance_on', guild)}
                                />
                                <ActionBtn
                                  icon={Trash2} label="Supprimer"
                                  cls="text-red-400 hover:bg-red-400/10"
                                  onClick={() => askConfirm('delete', guild)}
                                />
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ icon: Icon, label, cls, onClick }) {
  return (
    <button onClick={onClick} title={label}
      className={`p-1.5 rounded-lg transition-all ${cls}`}>
      <Icon size={14} />
    </button>
  );
}
