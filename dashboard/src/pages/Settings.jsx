import React, { useEffect, useRef, useState } from 'react';
import { Save, RefreshCw, Plus, X, Check, Loader2, ToggleLeft, ToggleRight, Upload, Bot } from 'lucide-react';
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

function FeatureToggle({ label, hint, checked, onChange, children }) {
  const on = !!checked;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink-2 font-medium">{label}</p>
        {hint && <p className="text-xs text-ink-4 mt-0.5">{hint}</p>}
        {on && children && <div className="mt-2">{children}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        className={`flex-shrink-0 mt-0.5 transition-colors ${on ? 'text-primary-light' : 'text-ink-4 hover:text-ink-3'}`}
        title={on ? 'Désactiver' : 'Activer'}
      >
        {on ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
      </button>
    </div>
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

  // Bot identity (per-guild)
  const [botIdentity, setBotIdentity]       = useState(null);
  const [botNickname, setBotNickname]       = useState('');
  const [avatarPreview, setAvatarPreview]   = useState(null);
  const [avatarDataUrl, setAvatarDataUrl]   = useState(null);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const avatarInputRef = useRef(null);

  const load = () => {
    setLoading(true);
    api.get('/config').then(r => setCfg(r.data)).finally(() => setLoading(false));
  };

  const loadBotIdentity = () => {
    api.get('/config/bot-identity')
      .then(r => {
        setBotIdentity(r.data);
        setBotNickname(r.data.nickname || '');
        setAvatarPreview(r.data.avatarUrl);
        setAvatarDataUrl(null);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    loadBotIdentity();
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

  const handleAvatarFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Image trop lourde (max 2 Mo)'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAvatarPreview(ev.target.result);
      setAvatarDataUrl(ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  const saveIdentity = async () => {
    setSavingIdentity(true);
    try {
      const body = {};
      const trimmed = botNickname.trim();
      if (trimmed !== (botIdentity?.nickname || '')) body.nickname = trimmed || null;
      if (avatarDataUrl) body.avatarDataUrl = avatarDataUrl;
      if (!Object.keys(body).length) { toast('Aucun changement.'); setSavingIdentity(false); return; }
      const { data } = await api.patch('/config/bot-identity', body);
      if (data.errors) {
        Object.values(data.errors).forEach(e => toast.error(e));
      } else {
        toast.success('Identité du bot mise à jour !');
        loadBotIdentity();
      }
    } catch (err) {
      const errs = err.response?.data?.errors;
      if (errs) Object.values(errs).forEach(e => toast.error(e));
      else toast.error(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSavingIdentity(false);
    }
  };

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
        webhookSecret:            sn(cfg.webhookSecret),
        faqEnabled:               cfg.faqEnabled ? 1 : 0,
        intakeFormEnabled:        cfg.intakeFormEnabled ? 1 : 0,
        staffReminderEnabled:     cfg.staffReminderEnabled ? 1 : 0,
        staffReminderHours:       cfg.staffReminderHours ?? 4,
        userInactiveEnabled:      cfg.userInactiveEnabled ? 1 : 0,
        userInactiveWarnHours:    cfg.userInactiveWarnHours ?? 24,
        userInactiveCloseHours:   cfg.userInactiveCloseHours ?? 72,
        internalNotesEnabled:     cfg.internalNotesEnabled !== false ? 1 : 0,
        badgesEnabled:            cfg.badgesEnabled ? 1 : 0,
        monthlyGoalsEnabled:      cfg.monthlyGoalsEnabled ? 1 : 0,
        leaderboardEnabled:       cfg.leaderboardEnabled !== false ? 1 : 0,
        webhooksEnabled:          cfg.webhooksEnabled ? 1 : 0,
        webhookEvents:            cfg.webhookEvents || ['ticket_open', 'ticket_close', 'ticket_claim'],
        apiKeysEnabled:           cfg.apiKeysEnabled ? 1 : 0,
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

      {/* Bot Discord identity (per-guild) */}
      <Section
        title="Apparence du bot sur ce serveur"
        description="Pseudo et photo de profil visibles uniquement sur ce serveur Discord"
      >
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <div className="relative group">
              <div className="w-20 h-20 rounded-full overflow-hidden ring-2 ring-white/10 bg-surface">
                {avatarPreview
                  ? <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center">
                      <Bot size={28} className="text-ink-4" />
                    </div>
                }
              </div>
              <button
                onClick={() => avatarInputRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100
                           flex items-center justify-center transition-opacity cursor-pointer"
                title="Changer l'avatar"
              >
                <Upload size={18} className="text-white" />
              </button>
            </div>
            <button
              onClick={() => avatarInputRef.current?.click()}
              className="text-xs text-ink-4 hover:text-ink-2 transition-colors"
            >
              Changer
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={handleAvatarFile}
            />
          </div>

          {/* Nickname */}
          <div className="flex-1 space-y-3">
            <Field label="Pseudo sur ce serveur" hint="Laisse vide pour utiliser le nom par défaut du bot (max 32 caractères)">
              <input
                type="text"
                value={botNickname}
                onChange={e => setBotNickname(e.target.value)}
                maxLength={32}
                placeholder={botIdentity?.username || 'Pseudo du bot'}
                className={BASE}
              />
            </Field>
            {botIdentity && (
              <p className="text-xs text-ink-4">
                Nom actuel : <span className="text-ink-3 font-medium">{botIdentity.displayName}</span>
                {botIdentity.nickname && <span className="ml-1 text-ink-4">(pseudo) · global : {botIdentity.username}</span>}
              </p>
            )}
            <button
              onClick={saveIdentity}
              disabled={savingIdentity}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-light
                         text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {savingIdentity ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {savingIdentity ? 'Mise à jour…' : 'Appliquer'}
            </button>
          </div>
        </div>
      </Section>

      {/* Bot embed identity */}
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
        <Field label="Webhook Secret" hint="Optionnel — clé HMAC-SHA256 pour vérifier les signatures (min 16 caractères)">
          <input type="password" value={cfg.webhookSecret || ''} onChange={e => set('webhookSecret', e.target.value || null)}
            placeholder="••••••••••••••••" autoComplete="off" className={BASE} />
        </Field>
      </Section>

      {/* Feature flags */}
      <Section title="Fonctionnalités" description="Active ou désactive les fonctionnalités avancées pour ce serveur.">
        <FeatureToggle
          label="Auto-réponses FAQ"
          hint="Répond automatiquement aux mots-clés en DM avant la création d'un ticket"
          checked={cfg.faqEnabled} onChange={v => set('faqEnabled', v)}
        />
        <FeatureToggle
          label="Formulaires d'intake"
          hint="Affiche un questionnaire configurable avant l'ouverture du ticket"
          checked={cfg.intakeFormEnabled} onChange={v => set('intakeFormEnabled', v)}
        />
        <FeatureToggle
          label="Rappels staff automatiques"
          hint="DM au staff claimer si aucune réponse dans le délai configuré"
          checked={cfg.staffReminderEnabled} onChange={v => set('staffReminderEnabled', v)}
        >
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-3">Délai (h)</label>
            <input type="number" min={1} max={168} value={cfg.staffReminderHours ?? 4}
              onChange={e => set('staffReminderHours', parseInt(e.target.value))} className={NUM_INPUT} />
          </div>
        </FeatureToggle>
        <FeatureToggle
          label="Fermeture par inactivité utilisateur"
          hint="Ferme le ticket si l'utilisateur ne répond pas après le staff"
          checked={cfg.userInactiveEnabled} onChange={v => set('userInactiveEnabled', v)}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-ink-3 whitespace-nowrap">Avertissement (h)</label>
              <input type="number" min={1} max={720} value={cfg.userInactiveWarnHours ?? 24}
                onChange={e => set('userInactiveWarnHours', parseInt(e.target.value))} className={NUM_INPUT} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-ink-3 whitespace-nowrap">Fermeture (h)</label>
              <input type="number" min={1} max={720} value={cfg.userInactiveCloseHours ?? 72}
                onChange={e => set('userInactiveCloseHours', parseInt(e.target.value))} className={NUM_INPUT} />
            </div>
          </div>
        </FeatureToggle>
        <FeatureToggle
          label="Notes internes staff"
          hint="Permet au staff d'ajouter des notes privées (/note) invisibles à l'utilisateur"
          checked={cfg.internalNotesEnabled !== false} onChange={v => set('internalNotesEnabled', v)}
        />
        <FeatureToggle
          label="Badges débloquables"
          hint="Attribue automatiquement des badges aux membres staff selon leurs performances"
          checked={cfg.badgesEnabled} onChange={v => set('badgesEnabled', v)}
        />
        <FeatureToggle
          label="Objectifs mensuels"
          hint="Quota de tickets mensuel avec barre de progression sur le profil"
          checked={cfg.monthlyGoalsEnabled} onChange={v => set('monthlyGoalsEnabled', v)}
        />
        <FeatureToggle
          label="Leaderboard dashboard"
          hint="Classement staff hebdomadaire / mensuel sur la page d'accueil"
          checked={cfg.leaderboardEnabled !== false} onChange={v => set('leaderboardEnabled', v)}
        />
        <FeatureToggle
          label="Webhooks sortants"
          hint="Appels HTTP sur les événements tickets (ouverture, fermeture, claim…)"
          checked={cfg.webhooksEnabled} onChange={v => set('webhooksEnabled', v)}
        >
          <div className="space-y-1">
            <p className="text-xs text-ink-4 mb-1">Événements à notifier :</p>
            {['ticket_open','ticket_close','ticket_claim','ticket_note','ticket_priority'].map(evt => (
              <label key={evt} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox"
                  checked={(cfg.webhookEvents || ['ticket_open','ticket_close','ticket_claim']).includes(evt)}
                  onChange={e => {
                    const cur = cfg.webhookEvents || ['ticket_open','ticket_close','ticket_claim'];
                    set('webhookEvents', e.target.checked ? [...cur, evt] : cur.filter(x => x !== evt));
                  }}
                  className="accent-primary" />
                <span className="text-xs text-ink-3 font-mono">{evt}</span>
              </label>
            ))}
          </div>
        </FeatureToggle>
        <FeatureToggle
          label="API publique"
          hint="Génère des clés d'API pour interagir avec le bot depuis des services externes"
          checked={cfg.apiKeysEnabled} onChange={v => set('apiKeysEnabled', v)}
        />
      </Section>
    </div>
  );
}
