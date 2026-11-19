import React, { useEffect, useState } from 'react';
import { uiLocale } from '../../i18n';
import {
  Building2, CheckCircle, XCircle, RefreshCw,
  Trash2, Play, Pause, Search, Loader2, AlertTriangle, WrenchIcon, Crown, UserPlus, X, Link2, Unlink
} from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../../utils/confirmToast';

const STATUS = {
  active:    { label: 'Actif',    cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle },
  suspended: { label: 'Suspendu', cls: 'text-red-300 bg-red-500/10 border-red-500/20',             icon: XCircle },
};

const TABS = ['all', 'active', 'suspended'];
const TAB_LABEL = { all: 'Tous', active: 'Actifs', suspended: 'Suspendus' };

function GuildIcon({ guild }) {
  const [err, setErr] = useState(false);
  if (guild.guild_icon && !err) {
    return (
      <img
        src={`https://cdn.discordapp.com/icons/${guild.guild_id}/${guild.guild_icon}.webp?size=32`}
        alt="" className="w-8 h-8 rounded-lg ring-1 ring-overlay/10 object-cover shrink-0"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-lg bg-linear-to-br from-violet-500 to-indigo-600
                    flex items-center justify-center shrink-0">
      <Building2 size={13} className="text-white" />
    </div>
  );
}

function ConfirmModal({ message, onConfirm, onCancel, danger }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="glass-dark rounded-2xl border border-overlay/8 p-6 w-full max-w-sm space-y-4
                      shadow-2xl">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className={danger ? 'text-red-400 shrink-0 mt-0.5' : 'text-amber-400 shrink-0 mt-0.5'} />
          <p className="text-sm text-ink-2">{message}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1
                       hover:bg-overlay/5 transition-all">
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

// Founders of a tenant's dashboard; the owner of the instance can appoint new ones by Discord ID.
function FoundersModal({ guild, onClose }) {
  const [founders, setFounders] = useState(null);
  const [discordId, setDiscordId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => api.get(`/instance/guilds/${guild.guild_id}/founders`)
    .then(r => setFounders(r.data))
    .catch(err => { toast.error(err.response?.data?.error || 'Erreur chargement'); setFounders([]); });

  useEffect(() => { load(); }, [guild.guild_id]);

  const remove = async (f) => {
    if (!await confirmToast(`Retirer ${f.username || f.user_id} des fondateurs ?`)) return;
    try {
      await api.delete(`/instance/guilds/${guild.guild_id}/founders/${f.user_id}`);
      toast.success(`${f.username || f.user_id} n'est plus fondateur`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  };

  const add = async (e) => {
    e.preventDefault();
    const id = discordId.trim();
    if (!/^\d{17,20}$/.test(id)) return toast.error('ID Discord invalide (17 à 20 chiffres)');
    setSaving(true);
    try {
      const r = await api.post(`/instance/guilds/${guild.guild_id}/founders`, { discordId: id });
      toast.success(`${r.data.username} est maintenant fondateur`);
      if (!r.data.isMember) toast(`⚠️ ${r.data.username} n'est pas membre du serveur Discord`, { duration: 6000 });
      setDiscordId('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="glass-dark rounded-2xl border border-overlay/8 p-6 w-full max-w-md space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-1 flex items-center gap-2">
            <Crown size={15} className="text-amber-400" /> Fondateurs — {guild.guild_name}
          </h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink-1"><X size={16} /></button>
        </div>

        {founders === null ? (
          <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-ink-3" /></div>
        ) : founders.length === 0 ? (
          <p className="text-xs text-ink-4 text-center py-4">Aucun fondateur</p>
        ) : (
          <ul className="space-y-1.5 max-h-64 overflow-y-auto">
            {founders.map(f => (
              <li key={f.user_id} className="flex items-center justify-between gap-2 rounded-lg bg-overlay/3 border border-overlay/6 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-ink-1 truncate">{f.username || f.user_id}</p>
                  <p className="text-[10px] font-mono text-ink-4">{f.user_id}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {f.isInviter && <span className="text-[10px] px-1.5 py-0.5 rounded-md border text-indigo-300 bg-indigo-500/10 border-indigo-500/20">Invitant</span>}
                  {f.isOwner && <span className="text-[10px] px-1.5 py-0.5 rounded-md border text-amber-300 bg-amber-500/10 border-amber-500/20">Propriétaire</span>}
                  {founders.length > 1 && (
                    <button onClick={() => remove(f)} title="Retirer des fondateurs"
                      className="p-1 rounded-md text-ink-4 hover:text-red-400 hover:bg-red-400/10 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={add} className="space-y-2 pt-2 border-t border-overlay/6">
          <label className="text-xs font-medium text-ink-3">Ajouter un fondateur (ID Discord)</label>
          <div className="flex gap-2">
            <input value={discordId} onChange={e => setDiscordId(e.target.value)}
              placeholder="123456789012345678" inputMode="numeric" maxLength={20}
              className="flex-1 px-3 py-2 rounded-xl bg-overlay/4 border border-overlay/8 text-sm text-ink-1
                         placeholder-ink-4 outline-hidden focus:border-primary/50 font-mono" />
            <button type="submit" disabled={saving}
              className="px-3 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary-light
                         disabled:opacity-60 flex items-center gap-1.5">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Ajouter
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Link a space to a Discord server (the bot is invited there, the space takes the server's ID when
// it arrives), or unlink it (the bot leaves, the space and its tickets stay)
function DiscordModal({ guild, onClose, onDone }) {
  const linking = Number(guild.discord) === 0;
  const [serverId, setServerId] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(null);
  const link = async () => {
    setBusy(true);
    try { const { data } = await api.post(`/instance/guilds/${guild.guild_id}/discord/link`, { discordGuildId: serverId }); setUrl(data.url); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const unlink = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/instance/guilds/${guild.guild_id}/discord/unlink`, { confirm });
      toast.success(`Serveur Discord délié${data.openTickets ? ` : ${data.openTickets} ticket(s) ouvert(s) continuent dans le dashboard` : ''}`);
      onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const input = 'w-full bg-surface border border-overlay/8 rounded-xl px-3 py-2 text-sm text-ink-1';
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={linking ? 'Relier à Discord' : 'Délier de Discord'}>
      <div className="w-full max-w-md bg-surface-card border border-overlay/8 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-1">{linking ? 'Relier à un serveur Discord' : 'Délier du serveur Discord'} — {guild.guild_name}</h2>
          <button onClick={onClose} aria-label="Fermer" className="p-1 text-ink-3 hover:text-ink-1"><X size={14} /></button>
        </div>
        {linking ? (url ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-2">Invite le bot sur ce serveur avec ce lien (valable une heure). Dès qu'il arrive, l'espace devient celui du serveur : tickets, réglages et équipe sont conservés.</p>
            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block px-4 py-2 rounded-xl bg-[#5865F2] text-white text-sm font-semibold">Inviter le bot</a>
            <p className="text-xs text-ink-4">Les personnes connectées à cet espace devront le rechoisir dans Mes espaces.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-ink-3">Identifiant du serveur Discord (clic droit sur le serveur → Copier l'identifiant, mode développeur activé).</p>
            <input value={serverId} onChange={e => setServerId(e.target.value.trim())} inputMode="numeric" placeholder="123456789012345678" aria-label="Identifiant du serveur Discord" className={input} />
            <button onClick={link} disabled={busy || !serverId} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-50">Préparer l'invitation</button>
          </div>
        )) : (
          <div className="space-y-2">
            <p className="text-sm text-ink-3">Le bot quitte le serveur Discord. L'espace, ses réglages, son équipe et ses tickets restent ; les tickets ouverts continuent dans le dashboard, par MP et par e-mail, sans salon.</p>
            <label className="block text-xs text-ink-3">Pour confirmer, recopie le nom de l'espace : <strong className="text-ink-2" translate="no">{guild.guild_name}</strong>
              <input value={confirm} onChange={e => setConfirm(e.target.value)} className={`${input} mt-1`} />
            </label>
            <button onClick={unlink} disabled={busy || confirm.trim() !== guild.guild_name} className="px-4 py-2 rounded-xl bg-red-600/15 text-red-300 border border-red-600/30 text-sm font-semibold disabled:opacity-50">Délier</button>
          </div>
        )}
      </div>
    </div>
  );
}

// A space without a Discord server (v4): tickets by e-mail, member space and dashboard only
function NewSpace({ onCreated, spaces = [] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async e => {
    e.preventDefault();
    setBusy(true);
    try { await api.post('/instance/guilds', { name, templateId: templateId || undefined }); toast.success(templateId ? `Espace « ${name} » créé avec la configuration du modèle` : `Espace « ${name} » créé`); setName(''); setTemplateId(''); setOpen(false); onCreated(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  if (!open) return (
    <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-white">
      Créer un espace
    </button>
  );
  return (
    <form onSubmit={create} className="flex items-center gap-2">
      <input value={name} onChange={e => setName(e.target.value)} maxLength={100} autoFocus required placeholder="Nom de l'espace" aria-label="Nom de l'espace"
        className="bg-surface border border-overlay/8 rounded-xl px-3 py-2 text-sm text-ink-1 w-56" />
      <select value={templateId} onChange={e => setTemplateId(e.target.value)} aria-label="Reprendre la configuration de" title="Statuts, sujets, champs, grades, tags, formulaires, SLA, règles, catalogue, modèles et base de connaissances ; jamais l'équipe, les tickets ni les salons Discord"
        className="bg-surface border border-overlay/8 rounded-xl px-3 py-2 text-sm text-ink-1 max-w-56">
        <option value="">Configuration vierge</option>
        {spaces.filter(g => g.status === 'active').map(g => <option key={g.guild_id} value={g.guild_id}>{`Comme « ${g.guild_name || g.guild_id} »`}</option>)}
      </select>
      <button type="submit" disabled={busy || !name.trim()} className="px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-white disabled:opacity-50">Créer</button>
      <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1">Annuler</button>
    </form>
  );
}

export default function Guilds() {

  const [guilds, setGuilds]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [tab, setTab]             = useState('all');
  const [confirm, setConfirm]     = useState(null); // { action, guild }
  const [actioning, setActioning] = useState(null);
  const [foundersOf, setFoundersOf] = useState(null); // guild whose founders modal is open
  const [discordOf, setDiscordOf] = useState(null);   // space to link to / unlink from Discord

  const load = () => {
    setLoading(true);
    api.get('/instance/guilds').then(r => setGuilds(r.data)).catch(() => toast.error('Erreur chargement')).finally(() => setLoading(false));
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
      if (action === 'suspend') {
        await api.patch(`/instance/guilds/${guild.guild_id}/suspend`);
        toast.success(`${guild.guild_name} suspendu`);
      } else if (action === 'reactivate') {
        await api.patch(`/instance/guilds/${guild.guild_id}/reactivate`);
        toast.success(`${guild.guild_name} réactivé`);
      } else if (action === 'delete') {
        const { data } = await api.delete(`/instance/guilds/${guild.guild_id}`);
        if (data.wasInDiscord && !data.leftDiscord) toast.error(`${guild.guild_name} supprimé, mais le bot n'a pas pu quitter le serveur Discord`);
        else toast.success(`${guild.guild_name} supprimé${data.leftDiscord ? ' — le bot a quitté le serveur' : ''}`);
      } else if (action === 'maintenance_on') {
        await api.patch(`/instance/guilds/${guild.guild_id}/maintenance`, { enabled: true });
        toast.success(`Mode maintenance activé pour ${guild.guild_name}`);
      } else if (action === 'maintenance_off') {
        await api.patch(`/instance/guilds/${guild.guild_id}/maintenance`, { enabled: false });
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
      {foundersOf && (
        <FoundersModal guild={foundersOf} onClose={() => setFoundersOf(null)} />
      )}
      {discordOf && (
        <DiscordModal guild={discordOf} onClose={() => setDiscordOf(null)} onDone={() => { setDiscordOf(null); load(); }} />
      )}
      {confirm && (
        <ConfirmModal
          message={
            confirm.action === 'delete'
              ? `Supprimer définitivement ${confirm.guild.guild_name} et toute sa base de données ? Le bot quittera aussi le serveur Discord.`
              : confirm.action === 'suspend'
              ? `Suspendre l\'espace ${confirm.guild.guild_name} ?`
              : `Réactiver l\'espace ${confirm.guild.guild_name} ?`
          }
          danger={confirm.action === 'delete'}
          onConfirm={() => doAction(confirm.action, confirm.guild)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink-1">Espaces</h1>
          <p className="text-sm text-ink-3">{guilds.length} espace(s) enregistré(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <NewSpace onCreated={load} spaces={guilds} />
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-ink-3
                       hover:text-ink-1 hover:bg-overlay/5 transition-all border border-overlay/6">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualiser
          </button>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 p-1 rounded-xl bg-overlay/4 border border-overlay/6">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                         ${tab === t ? 'bg-primary/15 text-ink-1' : 'text-ink-3 hover:text-ink-2'}`}>
              {TAB_LABEL[t]}
              {counts[t] > 0 && (
                <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full
                                 ${tab === t ? 'bg-primary/20 text-primary-light' : 'bg-overlay/6 text-ink-4'}`}>
                  {counts[t]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-overlay/4 border border-overlay/6
                        flex-1 max-w-xs">
          <Search size={13} className="text-ink-4 shrink-0" />
          <input type="text" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-xs text-ink-1 placeholder-ink-4 outline-hidden" />
        </div>
      </div>

      {/* Table */}
      <div className="glass-dark rounded-2xl border border-overlay/8 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-primary-light" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-ink-3">Aucun espace trouvé</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-overlay/6">
                  {['Espace', 'Propriétaire', 'Statut', 'Membres', 'Créé le', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-ink-4 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-overlay/4">
                {filtered.map(guild => {
                  const st = STATUS[guild.status] || STATUS.active;
                  const Icon = st.icon;
                  const isActioning = actioning?.startsWith(guild.guild_id);
                  return (
                    <tr key={guild.guild_id} className="hover:bg-overlay/2 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <GuildIcon guild={guild} />
                          <div>
                            <p className="text-sm font-semibold text-ink-1 leading-tight">{guild.guild_name}</p>
                            <p className="text-[10px] text-ink-4 font-mono">{guild.guild_id}{Number(guild.discord) === 0 ? <span className="ml-1.5 font-sans text-ink-3">· sans Discord</span> : ''}</p>
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
                        {guild.created_at ? new Date(guild.created_at).toLocaleDateString(uiLocale()) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                        {!isActioning && (
                          <ActionBtn
                            icon={Crown} label="Fondateurs"
                            cls="text-amber-300 hover:bg-amber-400/10"
                            onClick={() => setFoundersOf(guild)}
                          />
                        )}
                        <div className="flex items-center gap-1.5">
                            {isActioning ? (
                              <Loader2 size={14} className="animate-spin text-ink-3" />
                            ) : (
                              <>
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
                                  icon={Number(guild.discord) === 0 ? Link2 : Unlink}
                                  label={Number(guild.discord) === 0 ? 'Relier à Discord' : 'Délier de Discord'}
                                  cls="text-ink-3 hover:bg-primary/10 hover:text-primary-light"
                                  onClick={() => setDiscordOf(guild)}
                                />
                                <ActionBtn
                                  icon={Trash2} label="Supprimer"
                                  cls="text-red-400 hover:bg-red-400/10"
                                  onClick={() => askConfirm('delete', guild)}
                                />
                              </>
                            )}
                          </div>
                        </div>
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
