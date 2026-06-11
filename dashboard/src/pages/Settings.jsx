import React, { useEffect, useState } from 'react';
import { Save, RefreshCw, Plus, X, Check, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

function Section({ title, description, children }) {
  return (
    <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5 space-y-4">
      <div className="border-b border-white/[0.06] pb-3">
        <h2 className="text-sm font-semibold text-ink-2">{title}</h2>
        {description && <p className="text-xs text-ink-4 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-sm text-ink-2 font-medium block mb-1">{label}</label>
      {hint && <p className="text-xs text-ink-4 mb-2">{hint}</p>}
      {children}
    </div>
  );
}

const BASE = "w-full bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors";
const NUM_INPUT = BASE + " w-32";

function DiscordPickerSkeleton() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-white/[0.08]">
      <Loader2 size={12} className="animate-spin text-ink-4 flex-shrink-0" />
      <span className="text-xs text-ink-4">Chargement…</span>
    </div>
  );
}

function ChannelPicker({ value, onChange, channels, loading }) {
  if (loading) return <DiscordPickerSkeleton />;
  if (!channels.length) {
    return (
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value || null)}
        placeholder="ID du salon Discord" className={BASE} />
    );
  }
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value || null)}
      className={BASE + " cursor-pointer"}>
      <option value="">— Désactivé —</option>
      {channels.map(ch => (
        <option key={ch.id} value={ch.id}>#{ch.name}</option>
      ))}
    </select>
  );
}

function CategoryPicker({ value, onChange, categories, loading }) {
  if (loading) return <DiscordPickerSkeleton />;
  if (!categories.length) {
    return (
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value || null)}
        placeholder="ID de la catégorie Discord" className={BASE} />
    );
  }
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value || null)}
      className={BASE + " cursor-pointer"}>
      <option value="">— Aucune —</option>
      {categories.map(cat => (
        <option key={cat.id} value={cat.id}>{cat.name}</option>
      ))}
    </select>
  );
}

function RoleMultiPicker({ value, onChange, roles, loading }) {
  const selected = value || [];
  const toggle = (id) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  if (loading) return <DiscordPickerSkeleton />;
  if (!roles.length) return (
    <p className="text-xs text-ink-4 italic py-2">Bot Discord non disponible — rôles non chargés</p>
  );
  return (
    <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
      {roles.map(role => (
        <button key={role.id} type="button" onClick={() => toggle(role.id)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all
                     ${selected.includes(role.id)
                       ? 'bg-primary/10 border border-primary/20 text-ink-1'
                       : 'text-ink-3 hover:bg-white/[0.04] border border-transparent'}`}>
          {selected.includes(role.id)
            ? <Check size={12} className="text-primary-light flex-shrink-0" />
            : <div className="w-3 h-3 rounded border border-white/[0.15] flex-shrink-0" />
          }
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: role.color && role.color !== '#000000' ? role.color : '#6366f1' }} />
          <span className="truncate">{role.name}</span>
        </button>
      ))}
    </div>
  );
}

export default function Settings() {
  const [cfg, setCfg]               = useState(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [channels, setChannels]     = useState([]);
  const [categories, setCategories] = useState([]);
  const [roles, setRoles]           = useState([]);
  const [discordLoading, setDL]     = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/config').then(r => setCfg(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    Promise.all([
      api.get('/discord/channels').catch(() => ({ data: [] })),
      api.get('/discord/categories').catch(() => ({ data: [] })),
      api.get('/discord/roles').catch(() => ({ data: [] })),
    ]).then(([ch, cat, ro]) => {
      setChannels(ch.data);
      setCategories(cat.data);
      setRoles(ro.data);
    }).finally(() => setDL(false));
  }, []);

  const set = (key, val) => setCfg(c => ({ ...c, [key]: val }));

  const save = async () => {
    setSaving(true);
    try {
      const sn = v => (v === '' ? null : v || null);
      await api.patch('/config', {
        ticketPrefix:             cfg.ticketPrefix,
        welcomeMessage:           cfg.welcomeMessage || null,
        closeMessage:             cfg.closeMessage || null,
        botDisplayName:           cfg.botDisplayName || 'Ticket Bot',
        embedColor:               cfg.embedColor || '#6366f1',
        ticketSubjects:           cfg.ticketSubjects || [],
        maxTicketsPerDay:         cfg.maxTicketsPerDay,
        inactiveWarningHours:     cfg.inactiveWarningHours,
        inactiveHours:            cfg.inactiveHours,
        replyRateLimitSeconds:    cfg.replyRateLimitSeconds,
        ticketCategoryId:         sn(cfg.ticketCategoryId),
        supportRoleIds:           cfg.supportRoleIds || [],
        chiefRoleIds:             cfg.chiefRoleIds || [],
        closeLogChannelId:        sn(cfg.closeLogChannelId),
        claimLogChannelId:        sn(cfg.claimLogChannelId),
        moveLogChannelId:         sn(cfg.moveLogChannelId),
        addUserLogChannelId:      sn(cfg.addUserLogChannelId),
        removeUserLogChannelId:   sn(cfg.removeUserLogChannelId),
        weeklyReportChannelId:    sn(cfg.weeklyReportChannelId),
        spamAlertChannelId:       sn(cfg.spamAlertChannelId),
        escalationAlertChannelId: sn(cfg.escalationAlertChannelId),
        escalationAlertHours:     cfg.escalationAlertHours,
        escalationCloseHours:     cfg.escalationCloseHours,
        webhookUrl:               sn(cfg.webhookUrl),
      });
      toast.success('Configuration sauvegardée !');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const addSubject = () => {
    if (!newSubject.trim()) return;
    set('ticketSubjects', [...(cfg.ticketSubjects || []), newSubject.trim()]);
    setNewSubject('');
  };
  const removeSubject = (i) => set('ticketSubjects', cfg.ticketSubjects.filter((_, idx) => idx !== i));

  if (loading) return <div className="p-6 text-ink-3">Chargement...</div>;
  if (!cfg) return <div className="p-6 text-red-400">Impossible de charger la configuration.</div>;

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Paramètres</h1>
          <p className="text-sm text-ink-3 mt-0.5">Configuration du bot pour ce serveur</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface transition-colors"
            title="Recharger">
            <RefreshCw size={16} />
          </button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-light
                       text-white text-sm font-medium transition-colors disabled:opacity-50">
            <Save size={15} />
            {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
        </div>
      </div>

      {/* Bot identity */}
      <Section title="Identité du bot">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nom d'affichage" hint="Utilisé dans les embeds et messages">
            <input type="text" value={cfg.botDisplayName || ''} onChange={e => set('botDisplayName', e.target.value)}
              placeholder="Ticket Bot" className={BASE} />
          </Field>
          <Field label="Couleur des embeds" hint="Hexadécimal — ex: #6366f1">
            <div className="flex items-center gap-2">
              <input type="color" value={cfg.embedColor || '#6366f1'} onChange={e => set('embedColor', e.target.value)}
                className="w-10 h-9 rounded-lg border border-white/[0.08] bg-transparent cursor-pointer p-0.5 flex-shrink-0" />
              <input type="text" value={cfg.embedColor || '#6366f1'} onChange={e => set('embedColor', e.target.value)}
                pattern="^#[0-9a-fA-F]{6}$" placeholder="#6366f1" className={BASE + " font-mono"} />
            </div>
          </Field>
        </div>
      </Section>

      {/* General */}
      <Section title="Général">
        <Field label="Préfixe des tickets" hint="Nom des salons créés (ex: ticket → #ticket-0001)">
          <input type="text" value={cfg.ticketPrefix || ''} onChange={e => set('ticketPrefix', e.target.value)}
            className={BASE} />
        </Field>
        <Field label="Message de bienvenue DM" hint="Envoyé à l'utilisateur lors de la création du ticket">
          <textarea value={cfg.welcomeMessage || ''} onChange={e => set('welcomeMessage', e.target.value)} rows={3}
            className={BASE + " resize-none"} />
        </Field>
        <Field label="Message de fermeture DM" hint="Envoyé à l'utilisateur quand son ticket est fermé (facultatif)">
          <textarea value={cfg.closeMessage || ''} onChange={e => set('closeMessage', e.target.value)} rows={2}
            placeholder="Votre ticket a été fermé. Merci de nous avoir contactés." className={BASE + " resize-none"} />
        </Field>
      </Section>

      {/* Subjects */}
      <Section title="Sujets de ticket">
        <Field label="Menu de sujets" hint="Affiché en DM avant la création du ticket. Laisse vide pour désactiver.">
          <div className="space-y-2">
            {(cfg.ticketSubjects || []).map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="flex-1 bg-surface border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-2">{s}</span>
                <button onClick={() => removeSubject(i)}
                  className="p-1.5 text-ink-4 hover:text-red-400 transition-colors">
                  <X size={14} />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input type="text" value={newSubject} onChange={e => setNewSubject(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSubject()}
                placeholder="Ajouter un sujet…" className={BASE + " flex-1"} />
              <button onClick={addSubject}
                className="px-3 py-2 rounded-lg bg-surface border border-white/[0.08] text-ink-2
                           hover:text-ink-1 transition-colors">
                <Plus size={15} />
              </button>
            </div>
          </div>
        </Field>
      </Section>

      {/* Access roles + category */}
      <Section title="Rôles d'accès" description="Rôles Discord ayant accès au bot et au dashboard">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Field label="Rôles support" hint="Accès standard aux tickets">
            <RoleMultiPicker value={cfg.supportRoleIds} onChange={v => set('supportRoleIds', v)}
              roles={roles} loading={discordLoading} />
          </Field>
          <Field label="Rôles chef support" hint="Accès étendu : blacklist, transcripts, stats">
            <RoleMultiPicker value={cfg.chiefRoleIds} onChange={v => set('chiefRoleIds', v)}
              roles={roles} loading={discordLoading} />
          </Field>
        </div>
        <Field label="Catégorie de tickets" hint="Catégorie Discord où les nouveaux tickets sont créés">
          <CategoryPicker value={cfg.ticketCategoryId} onChange={v => set('ticketCategoryId', v)}
            categories={categories} loading={discordLoading} />
        </Field>
      </Section>

      {/* Limits */}
      <Section title="Limites et délais">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tickets max / jour" hint="Par utilisateur">
            <input type="number" min={1} max={100} value={cfg.maxTicketsPerDay ?? 3}
              onChange={e => set('maxTicketsPerDay', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
          <Field label="Rate limit /reply (sec)" hint="Délai min entre deux réponses staff">
            <input type="number" min={0} max={300} value={cfg.replyRateLimitSeconds ?? 3}
              onChange={e => set('replyRateLimitSeconds', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
          <Field label="Avertissement inactivité (h)">
            <input type="number" min={1} max={720} value={cfg.inactiveWarningHours ?? 24}
              onChange={e => set('inactiveWarningHours', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
          <Field label="Fermeture auto inactivité (h)">
            <input type="number" min={1} max={720} value={cfg.inactiveHours ?? 48}
              onChange={e => set('inactiveHours', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
        </div>
      </Section>

      {/* Log channels */}
      <Section title="Salons de logs">
        <div className="space-y-3">
          {[
            ['closeLogChannelId',      'Fermeture de ticket'],
            ['claimLogChannelId',      'Claim'],
            ['moveLogChannelId',       'Déplacement'],
            ['addUserLogChannelId',    "Ajout d'utilisateur"],
            ['removeUserLogChannelId', "Retrait d'utilisateur"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <ChannelPicker value={cfg[key]} onChange={v => set(key, v)}
                channels={channels} loading={discordLoading} />
            </Field>
          ))}
        </div>
      </Section>

      {/* Automation channels */}
      <Section title="Salons d'automatisation">
        <div className="space-y-3">
          <Field label="Rapport hebdomadaire" hint="Envoyé chaque lundi à 9h — leaderboard staff de la semaine">
            <ChannelPicker value={cfg.weeklyReportChannelId} onChange={v => set('weeklyReportChannelId', v)}
              channels={channels} loading={discordLoading} />
          </Field>
          <Field label="Alertes anti-spam" hint="Notifié quand un utilisateur dépasse la limite quotidienne">
            <ChannelPicker value={cfg.spamAlertChannelId} onChange={v => set('spamAlertChannelId', v)}
              channels={channels} loading={discordLoading} />
          </Field>
          <Field label="Alertes d'escalade" hint="Notifié quand un ticket urgent reste sans réponse staff">
            <ChannelPicker value={cfg.escalationAlertChannelId} onChange={v => set('escalationAlertChannelId', v)}
              channels={channels} loading={discordLoading} />
          </Field>
        </div>
      </Section>

      {/* Escalation */}
      <Section title="Escalade automatique"
        description="Un ticket urgent sans réponse staff déclenche une alerte puis une fermeture.">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Délai d'alerte (h)" hint="Sans réponse avant alerte Discord">
            <input type="number" min={1} max={48} value={cfg.escalationAlertHours ?? 2}
              onChange={e => set('escalationAlertHours', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
          <Field label="Délai de fermeture (h)" hint="Sans réponse avant fermeture auto">
            <input type="number" min={1} max={168} value={cfg.escalationCloseHours ?? 4}
              onChange={e => set('escalationCloseHours', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
        </div>
      </Section>

      {/* Integrations */}
      <Section title="Intégrations">
        <Field label="Webhook URL" hint="Facultatif — notifications externes sur les événements tickets">
          <input type="url" value={cfg.webhookUrl || ''} onChange={e => set('webhookUrl', e.target.value)}
            placeholder="https://discord.com/api/webhooks/…" className={BASE} />
        </Field>
      </Section>
    </div>
  );
}
