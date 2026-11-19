import React, { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Save, RefreshCw, Plus, X, Check, Loader2, ToggleLeft, ToggleRight, Upload, Bot, Settings2, ShieldCheck, Ticket, Hash, Sparkles, Plug, Archive, CalendarClock, Workflow, BellRing, LayoutGrid } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import SubjectRules from '../components/SubjectRules';
import ConfigTransfer from '../components/ConfigTransfer';
import ConfigHistory from '../components/ConfigHistory';
import PortalBranding from '../components/PortalBranding';
import BackupKey from '../components/BackupKey';
import PublicStats from '../components/PublicStats';
import BotImport from '../components/BotImport';
import EmailSettings from '../components/EmailSettings';
import WidgetSettings from '../components/WidgetSettings';
import StagesEditor from '../components/StagesEditor';
import SubjectTreeEditor from '../components/SubjectTreeEditor';
import CalendarsEditor from '../components/CalendarsEditor';
import SlaPoliciesEditor from '../components/SlaPoliciesEditor';
import RulesEditor from '../components/RulesEditor';
import NotificationsEditor from '../components/NotificationsEditor';
import ChatIntegrations from '../components/ChatIntegrations';
import CatalogEditor from '../components/CatalogEditor';
import { LEVEL_LABELS, URGENCY_LABELS, IMPACT_LABELS } from '../utils/priorityLevels';
import { useAuth } from '../App';

// What each ticket format does (Paramètres → Tickets)
const TICKET_MODE_HINT = {
  auto: 'Un salon par ticket, avec des catégories « 2 », « 3 »… quand une catégorie est pleine. Quand le serveur atteint 500 salons, les nouveaux tickets deviennent des fils privés du salon choisi ci-contre.',
  channel: 'Un salon par ticket, avec des catégories « 2 », « 3 »… quand une catégorie est pleine. Quand le serveur atteint 500 salons, les nouveaux tickets sont refusés : le membre est prévenu et les fondateurs reçoivent un MP.',
  thread: 'Chaque ticket est un fil privé du salon choisi : aucune limite de salons. Le staff y est ajouté un par un (rôles support et comptes du dashboard) ; les étapes ne déplacent plus rien sur Discord.',
  database: 'Aucun salon ni fil sur Discord : les tickets ne vivent que dans le dashboard, où le staff répond. Les membres écrivent toujours au bot en MP (ou dans l\'espace membre) et reçoivent les réponses en MP. Les commandes du staff dans les salons de tickets ne servent plus.',
};

// `description` / `hint`: shown on hover only, the page stays free of explanatory text
function Section({ title, description, children }) {
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-5 space-y-4">
      <div className="border-b border-overlay/6 pb-3">
        <h2 className="text-sm font-semibold text-ink-2" title={description}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

// A lone input/select/textarea gets the label through its id; anything else is a labelled group
function Field({ label, hint, children }) {
  const id = useId();
  const single = isValidElement(children) && ['input', 'select', 'textarea'].includes(children.type);
  return (
    <div>
      <label id={`${id}-l`} htmlFor={single ? (children.props.id || id) : undefined} className="text-sm text-ink-2 font-medium block mb-1" title={hint}>{label}</label>
      {single
        ? (children.props.id ? children : cloneElement(children, { id }))
        : <div role="group" aria-labelledby={`${id}-l`}>{children}</div>}
    </div>
  );
}

const BASE = "w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary transition-colors";
const NUM_INPUT = BASE + " w-32";

function DiscordPickerSkeleton() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-overlay/8">
      <Loader2 size={12} className="animate-spin text-ink-4 shrink-0" />
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
    <div className="flex items-start gap-3 py-2.5 border-b border-overlay/4 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink-2 font-medium" title={hint}>{label}</p>
        {on && children && <div className="mt-2">{children}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        className={`shrink-0 mt-0.5 transition-colors ${on ? 'text-primary-light' : 'text-ink-4 hover:text-ink-3'}`}
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
                       : 'text-ink-3 hover:bg-overlay/4 border border-transparent'}`}>
          {selected.includes(role.id)
            ? <Check size={12} className="text-primary-light shrink-0" />
            : <div className="w-3 h-3 rounded-sm border border-overlay/15 shrink-0" />
          }
          <span className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: role.color && role.color !== '#000000' ? role.color : '#6366f1' }} />
          <span className="truncate">{role.name}</span>
        </button>
      ))}
    </div>
  );
}

// Tabs of the page; the current one is kept in the address (?tab=) so a link can open it directly
const TABS = [
  { id: 'general',       label: 'Général',            icon: Settings2 },
  { id: 'acces',         label: 'Accès et sécurité',  icon: ShieldCheck },
  { id: 'tickets',       label: 'Tickets',            icon: Ticket },
  { id: 'horaires',      label: 'Horaires',           icon: CalendarClock },
  { id: 'catalogue',     label: 'Catalogue',          icon: LayoutGrid },
  { id: 'regles',        label: 'Règles',             icon: Workflow },
  { id: 'notifications', label: 'Notifications',      icon: BellRing },
  { id: 'salons',        label: 'Salons',             icon: Hash, discord: true },
  { id: 'fonctions',     label: 'Fonctionnalités',    icon: Sparkles },
  { id: 'integrations',  label: 'Intégrations',       icon: Plug },
  { id: 'sauvegarde',    label: 'Sauvegarde',         icon: Archive },
];

// Accessible tab list: arrow keys, Home / End, roving focus
function TabList({ tabs: TABS, current, onChange }) {
  const refs = useRef({});
  const move = (e, i) => {
    const n = TABS.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    onChange(TABS[next].id);
    refs.current[TABS[next].id]?.focus();
  };
  return (
    <div role="tablist" aria-label="Catégories de paramètres" className="flex gap-1 overflow-x-auto border-b border-overlay/6 -mx-1 px-1">
      {TABS.map((t, i) => {
        const Icon = t.icon;
        const active = t.id === current;
        return (
          <button key={t.id} ref={el => { refs.current[t.id] = el; }} role="tab" type="button" id={`tab-${t.id}`}
            aria-selected={active} aria-controls={`panel-${t.id}`} tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)} onKeyDown={e => move(e, i)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${active ? 'border-primary text-ink-1 font-medium' : 'border-transparent text-ink-3 hover:text-ink-1'}`}>
            <Icon size={14} aria-hidden="true" />{t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [cfg, setCfg]               = useState(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [channels, setChannels]     = useState([]);
  const [categories, setCategories] = useState([]);
  const [roles, setRoles]           = useState([]);
  const [grades, setGrades] = useState([]);
  const [historyKey, setHistoryKey] = useState(0);
  const [discordLoading, setDL]     = useState(true);
  const [params, setParams] = useSearchParams();
  // Without a linked Discord server, what only concerns Discord is hidden (channels, roles, bot)
  const discord = user?.discord !== false;
  const tabs = TABS.filter(t => discord || !t.discord);
  const tab = tabs.some(t => t.id === params.get('tab')) ? params.get('tab') : 'general';
  const setTab = id => setParams(p => { const n = new URLSearchParams(p); n.set('tab', id); return n; }, { replace: true });
  const [savedJson, setSavedJson] = useState(null);

  // Bot identity (per-guild)
  const [botIdentity, setBotIdentity]       = useState(null);
  const [botNickname, setBotNickname]       = useState('');
  const [avatarPreview, setAvatarPreview]   = useState(null);
  const [avatarDataUrl, setAvatarDataUrl]   = useState(null);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const avatarInputRef = useRef(null);

  const load = () => {
    setLoading(true);
    api.get('/config').then(r => { setCfg(r.data); setSavedJson(JSON.stringify(r.data)); }).finally(() => setLoading(false));
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
      api.get('/grades').catch(() => ({ data: [] })),
    ]).then(([ch, cat, ro, gr]) => {
      setChannels(ch.data);
      setCategories(cat.data);
      setRoles(ro.data);
      setGrades(gr.data);
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
        botLanguage:              cfg.botLanguage || 'fr',
        staffLanguage:            cfg.staffLanguage || 'fr',
        require2fa:               cfg.require2fa || 'none',
        idleTimeoutMinutes:       cfg.idleTimeoutMinutes ?? 0,
        memberReopenDays:         cfg.memberReopenDays ?? 7,
        notifyMemberStage:        cfg.notifyMemberStage ? 1 : 0,
        memberPortalEnabled:      cfg.memberPortalEnabled === undefined || cfg.memberPortalEnabled ? 1 : 0,
        portalEmailOpen:          cfg.portalEmailOpen ? 1 : 0,
        portalLogo:               cfg.portalLogo || null,
        portalColor:              /^#[0-9a-fA-F]{6}$/.test(cfg.portalColor || '') ? cfg.portalColor : null,
        portalWelcome:            cfg.portalWelcome?.trim() || null,
        lowRatingThreshold:       cfg.lowRatingThreshold ?? 2,
        ticketSubjects:           cfg.ticketSubjects || [],
        subjectSla:               cfg.subjectSla && typeof cfg.subjectSla === 'object' ? cfg.subjectSla : {},
        ticketTypesEnabled:       cfg.ticketTypesEnabled ? 1 : 0,
        resolutionEnabled:        cfg.resolutionEnabled ? 1 : 0,
        priorityMatrixEnabled:    cfg.priorityMatrixEnabled ? 1 : 0,
        priorityMatrix:           Array.isArray(cfg.priorityMatrix) && cfg.priorityMatrix.length === 5 ? cfg.priorityMatrix : null,
        resolutionAutocloseDays:  Number.isInteger(cfg.resolutionAutocloseDays) ? cfg.resolutionAutocloseDays : 7,
        ticketTypeLabels:         { incident: cfg.ticketTypeLabels?.incident?.trim() || 'Incident', request: cfg.ticketTypeLabels?.request?.trim() || 'Demande' },
        // Only the subjects that still exist; « request » kept only on a sub-category (it overrides its category)
        subjectTypes:             Object.fromEntries(Object.entries(cfg.subjectTypes || {}).filter(([k, v]) => (cfg.ticketSubjects || []).includes(k) && (v === 'incident' || (v === 'request' && k.includes(' › '))))),
        maxTicketsPerDay:         cfg.maxTicketsPerDay,
        inactiveWarningHours:     cfg.inactiveWarningHours,
        inactiveHours:            cfg.inactiveHours,
        replyRateLimitSeconds:    cfg.replyRateLimitSeconds,
        ticketCategoryId:         sn(cfg.ticketCategoryId),
        waitingCategoryId:        sn(cfg.waitingCategoryId),
        inProgressCategoryId:     sn(cfg.inProgressCategoryId),
        ticketMode:               cfg.ticketMode || 'auto',
        threadParentChannelId:    sn(cfg.threadParentChannelId),
        slaOpenHours:             cfg.slaOpenHours ?? 0,
        slaWaitingHours:          cfg.slaWaitingHours ?? 0,
        slaInProgressHours:       cfg.slaInProgressHours ?? 0,
        supportRoleIds:           cfg.supportRoleIds || [],
        chiefRoleIds:             cfg.chiefRoleIds || [],
        supportGradeId:           cfg.supportGradeId || null,
        chiefGradeId:             cfg.chiefGradeId || null,
        closeLogChannelId:        sn(cfg.closeLogChannelId),
        claimLogChannelId:        sn(cfg.claimLogChannelId),
        moveLogChannelId:         sn(cfg.moveLogChannelId),
        addUserLogChannelId:      sn(cfg.addUserLogChannelId),
        removeUserLogChannelId:   sn(cfg.removeUserLogChannelId),
        weeklyReportChannelId:    sn(cfg.weeklyReportChannelId),
        monthlyReportChannelId:   sn(cfg.monthlyReportChannelId),
        spamAlertChannelId:       sn(cfg.spamAlertChannelId),
        escalationAlertChannelId: sn(cfg.escalationAlertChannelId),
        publicStatsChannelId:     sn(cfg.publicStatsChannelId),
        publicStatsTargetHours:   cfg.publicStatsTargetHours ?? 2,
        escalationAlertHours:     cfg.escalationAlertHours,
        escalationCloseHours:     cfg.escalationCloseHours,
        webhookUrl:               sn(cfg.webhookUrl),
        webhookSecret:            sn(cfg.webhookSecret),
        intakeFormEnabled:        cfg.intakeFormEnabled ? 1 : 0,
        staffReminderEnabled:     cfg.staffReminderEnabled ? 1 : 0,
        staffReminderHours:       cfg.staffReminderHours ?? 4,
        userInactiveEnabled:      cfg.userInactiveEnabled ? 1 : 0,
        userInactiveWarnHours:    cfg.userInactiveWarnHours ?? 24,
        userInactiveCloseHours:   cfg.userInactiveCloseHours ?? 72,
        internalNotesEnabled:     cfg.internalNotesEnabled !== false ? 1 : 0,
        monthlyGoalsEnabled:      cfg.monthlyGoalsEnabled ? 1 : 0,
        leaderboardEnabled:       cfg.leaderboardEnabled !== false ? 1 : 0,
        webhooksEnabled:          cfg.webhooksEnabled ? 1 : 0,
        webhookEvents:            cfg.webhookEvents || ['ticket_open', 'ticket_close', 'ticket_claim'],
        apiKeysEnabled:           cfg.apiKeysEnabled ? 1 : 0,
      });
      toast.success('Configuration sauvegardée !');
      setSavedJson(JSON.stringify(cfg));
      setHistoryKey(k => k + 1);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };


  const dirty = useMemo(() => !!cfg && savedJson !== null && JSON.stringify(cfg) !== savedJson, [cfg, savedJson]);
  // Leaving the page with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (loading) return <div className="p-6 text-ink-3">Chargement...</div>;
  if (!cfg) return <div className="p-6 text-red-400">Impossible de charger la configuration.</div>;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Paramètres</h1>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-amber-300" role="status">Modifications non enregistrées</span>}
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

      <TabList tabs={tabs} current={tab} onChange={setTab} />

      {tab === 'general' && (
        <div role="tabpanel" id="panel-general" aria-labelledby="tab-general" className="space-y-5">
      {/* Bot Discord identity (per-guild) */}
      {discord && (
      <Section
        title="Apparence du bot sur ce serveur"
        description="Pseudo et photo de profil visibles uniquement sur ce serveur Discord"
      >
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-2 shrink-0">
            <div className="relative group">
              <div className="w-20 h-20 rounded-full overflow-hidden ring-2 ring-overlay/10 bg-surface">
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
      )}

      {/* Language of the bot's messages to members */}
      <Section title="Langue du bot">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Langue des messages aux membres" hint="MP du bot : bienvenue, questions, notifications, boutons. En automatique : la langue Discord du membre parmi celles-ci, l'anglais sinon. Les textes personnalisés restent tels quels.">
            <select value={cfg.botLanguage || 'fr'} onChange={e => set('botLanguage', e.target.value)} className={BASE}>
              <option value="fr">Français</option>
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="de">Deutsch</option>
              <option value="it">Italiano</option>
              <option value="pt">Português (Brasil)</option>
              <option value="auto">Automatique (langue Discord du membre)</option>
            </select>
          </Field>
          <Field label="Langue du bot pour le staff" hint="Réponses aux commandes et aux boutons, messages du bot dans les salons de tickets et les salons de journal. En automatique : la langue Discord de chacun pour ce que lui seul voit, la langue du serveur pour ce que tout le monde voit. Le dashboard a son propre choix de langue.">
            <select value={cfg.staffLanguage || 'fr'} onChange={e => set('staffLanguage', e.target.value)} className={BASE}>
              <option value="fr">Français</option>
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="de">Deutsch</option>
              <option value="it">Italiano</option>
              <option value="pt">Português (Brasil)</option>
              <option value="auto">Automatique (langue Discord de chacun)</option>
            </select>
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
            className={BASE + " resize-none"} />
        </Field>
      </Section>

      {/* Subjects */}
      <Section title="Sujets de ticket">
        <Field label="Catégories et sous-catégories" hint="Proposées avant la création du ticket (sur Discord : la catégorie, puis la sous-catégorie). Une sous-catégorie hérite des règles, champs, formulaire, procédures, équipe et délai de sa catégorie. Le délai remplace celui de chaque étape qui en a un. Laisse vide pour ne rien proposer.">
          <SubjectTreeEditor subjects={cfg.ticketSubjects || []} sla={cfg.subjectSla || {}}
            onChange={(list, slaMap) => setCfg(c => ({ ...c, ticketSubjects: list, subjectSla: slaMap }))} />
        </Field>
        <SubjectRules subjects={cfg.ticketSubjects || []} />
      </Section>

      {/* Resolution and closing (v5.1) */}
      <Section title="Résolution et clôture">
        <label className="flex items-center gap-2 text-sm text-ink-1">
          <input type="checkbox" checked={!!cfg.resolutionEnabled} onChange={e => set('resolutionEnabled', e.target.checked)} className="accent-primary" />
          Résoudre avant de fermer : le demandeur confirme la solution (le ticket se ferme) ou répond (il reprend)
        </label>
        {cfg.resolutionEnabled && (
          <Field label="Fermer tout seul un ticket résolu sans réponse au bout de (jours, 0 = jamais)">
            <input type="number" min={0} max={90} value={cfg.resolutionAutocloseDays ?? 7} onChange={e => set('resolutionAutocloseDays', Math.max(0, Math.min(90, parseInt(e.target.value) || 0)))} className={BASE + ' w-28'} />
          </Field>
        )}
      </Section>

      {/* Priority matrix (v5.1) */}
      <Section title="Priorité : urgence × impact">
        <label className="flex items-center gap-2 text-sm text-ink-1">
          <input type="checkbox" checked={!!cfg.priorityMatrixEnabled} onChange={e => set('priorityMatrixEnabled', e.target.checked)} className="accent-primary" />
          Calculer la priorité à partir de l'urgence et de l'impact (6 niveaux, de « Très basse » à « Majeure »)
        </label>
        {cfg.priorityMatrixEnabled && (
          <Field label="Matrice" hint="Ligne : urgence. Colonne : impact. « Majeure » se choisit aussi à la main sur la fiche. Les 3 priorités d'avant suivent : Très basse et Basse = basse, Moyenne = normale, Haute et au-delà = urgente.">
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Matrice de priorité">
              <table className="text-xs">
                <thead><tr><th scope="col" className="p-1 text-left text-ink-4 font-medium">Urgence \ Impact</th>{[1, 2, 3, 4, 5].map(i => <th key={i} scope="col" className="p-1 text-ink-3 font-medium">{IMPACT_LABELS[i]}</th>)}</tr></thead>
                <tbody>
                  {[5, 4, 3, 2, 1].map(u => (
                    <tr key={u}>
                      <th scope="row" className="p-1 pr-2 text-left text-ink-3 font-medium whitespace-nowrap">{URGENCY_LABELS[u]}</th>
                      {[1, 2, 3, 4, 5].map(i => {
                        const m = Array.isArray(cfg.priorityMatrix) && cfg.priorityMatrix.length === 5 ? cfg.priorityMatrix : [[1, 1, 1, 1, 2], [1, 1, 2, 2, 3], [2, 2, 3, 4, 4], [2, 3, 4, 5, 5], [3, 4, 5, 5, 5]];
                        return (
                          <td key={i} className="p-1">
                            <select value={m[u - 1][i - 1]} aria-label={`Urgence ${URGENCY_LABELS[u]}, impact ${IMPACT_LABELS[i]}`}
                              onChange={e => set('priorityMatrix', m.map((row, ri) => row.map((v, ci) => (ri === u - 1 && ci === i - 1 ? Number(e.target.value) : v))))}
                              className="bg-surface border border-overlay/8 rounded-md px-1 py-1 text-[11px] text-ink-1">
                              {Object.entries(LEVEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Field>
        )}
      </Section>

      {/* Types of tickets (v5.1) */}
      <Section title="Types de tickets">
        <label className="flex items-center gap-2 text-sm text-ink-1">
          <input type="checkbox" checked={!!cfg.ticketTypesEnabled} onChange={e => set('ticketTypesEnabled', e.target.checked)} className="accent-primary" />
          Distinguer les incidents (quelque chose ne marche plus) des demandes (on demande quelque chose)
        </label>
        {cfg.ticketTypesEnabled && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nom des incidents">
                <input value={cfg.ticketTypeLabels?.incident ?? 'Incident'} maxLength={30} onChange={e => set('ticketTypeLabels', { ...cfg.ticketTypeLabels, incident: e.target.value })} className={BASE} />
              </Field>
              <Field label="Nom des demandes">
                <input value={cfg.ticketTypeLabels?.request ?? 'Demande'} maxLength={30} onChange={e => set('ticketTypeLabels', { ...cfg.ticketTypeLabels, request: e.target.value })} className={BASE} />
              </Field>
            </div>
            {(cfg.ticketSubjects || []).length > 0 && (
              <Field label="Type des nouveaux tickets, par sujet" hint="Une sous-catégorie prend le type de sa catégorie si elle n'a pas le sien. Sans réglage : demande. Le staff change le type depuis la fiche.">
                <ul className="space-y-1.5">
                  {(cfg.ticketSubjects || []).map(sub => (
                    <li key={sub} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 min-w-0 truncate text-ink-2">{sub}</span>
                      <select value={cfg.subjectTypes?.[sub] || ''} aria-label={`Type des tickets « ${sub} »`} onChange={e => set('subjectTypes', { ...cfg.subjectTypes, [sub]: e.target.value || undefined })} className={BASE + ' w-40'}>
                        <option value="">{sub.includes(' › ') ? 'Comme la catégorie' : (cfg.ticketTypeLabels?.request || 'Demande')}</option>
                        <option value="incident">{cfg.ticketTypeLabels?.incident || 'Incident'}</option>
                        {sub.includes(' › ') && <option value="request">{cfg.ticketTypeLabels?.request || 'Demande'}</option>}
                      </select>
                    </li>
                  ))}
                </ul>
              </Field>
            )}
          </>
        )}
      </Section>

        </div>
      )}
      {tab === 'acces' && (
        <div role="tabpanel" id="panel-acces" aria-labelledby="tab-acces" className="space-y-5">
      {/* Access roles + category */}
      {discord && (
      <Section title="Rôles d'accès" description="Rôles Discord ayant accès au bot et au dashboard. Leurs membres obtiennent automatiquement un compte dashboard avec le grade associé (retiré s'ils perdent le rôle).">
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
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[['supportGradeId', 'Grade des rôles support'], ['chiefGradeId', 'Grade des rôles chef support']].map(([key, label]) => (
            <Field key={key} label={label} hint="Créé automatiquement à la première connexion si aucun n'est choisi">
              <select value={cfg[key] || ''} onChange={e => set(key, e.target.value ? parseInt(e.target.value) : null)}
                className="w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary">
                <option value="">Automatique</option>
                {grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
          ))}
        </div>
      </Section>
      )}

      <Section title="Sécurité">
        <Field label="Double authentification obligatoire" hint="Les comptes concernés sans 2FA ne peuvent plus accéder au dashboard tant qu'ils ne l'ont pas activée (depuis leur profil). Active d'abord la tienne.">
          <select value={cfg.require2fa || 'none'} onChange={e => set('require2fa', e.target.value)} className={BASE}>
            <option value="none">Non imposée</option>
            <option value="founders">Imposée aux fondateurs</option>
            <option value="staff">Imposée à tout le staff</option>
          </select>
        </Field>
        <Field label="Déconnexion après inactivité" hint="Sans clic, frappe ni défilement pendant cette durée, le compte est déconnecté (un avertissement s'affiche une minute avant). S'applique à tout le staff, fondateurs compris.">
          <select value={cfg.idleTimeoutMinutes ?? 0} onChange={e => set('idleTimeoutMinutes', Number(e.target.value))} className={BASE}>
            <option value={0}>Jamais</option>
            {[15, 30, 60, 120, 240, 480].map(m => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} heure${m > 60 ? 's' : ''}`}</option>)}
          </select>
        </Field>
        {user?.isOwner && (
          <Field label="Clé des sauvegardes" hint="Déchiffre les sauvegardes nocturnes de l'instance (tous les espaces). Réservée au propriétaire de l'instance ; chaque affichage est inscrit au journal de l'instance. Garde-la hors du serveur : sans elle, une sauvegarde est perdue.">
            <BackupKey />
          </Field>
        )}
      </Section>

        </div>
      )}
      {tab === 'tickets' && (
        <div role="tabpanel" id="panel-tickets" aria-labelledby="tab-tickets" className="space-y-5">
      <Section title={discord ? 'Tickets sur Discord' : 'Délais par étape'} description={discord ? 'Où et sous quelle forme les tickets sont créés sur le serveur Discord, et combien de temps chaque étape peut durer.' : 'Combien de temps chaque étape d\'un ticket peut durer.'}>
        {discord && <>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Field label="Format des tickets sur Discord" hint={TICKET_MODE_HINT[cfg.ticketMode || 'auto']}>
            <select value={cfg.ticketMode || 'auto'} onChange={e => set('ticketMode', e.target.value)}
              className="w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary">
              <option value="auto">Salons, puis fils privés quand il n'y a plus de place (recommandé)</option>
              <option value="channel">Salons uniquement</option>
              <option value="thread">Fils privés uniquement</option>
              <option value="database">Aucun salon : tout dans le dashboard</option>
            </select>
          </Field>
          {!['channel', 'database'].includes(cfg.ticketMode || 'auto') && (
            <Field label={cfg.ticketMode === 'thread' ? 'Salon des fils de tickets' : 'Salon des fils (quand il n\'y a plus de place)'}
              hint="Les fils privés y sont créés. Ne donne pas « Gérer les fils » aux rôles support sur ce salon : ils verraient aussi les tickets confidentiels.">
              <ChannelPicker value={cfg.threadParentChannelId} onChange={v => set('threadParentChannelId', v)} channels={channels} loading={discordLoading} />
            </Field>
          )}
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {[
            ['ticketCategoryId', 'Catégorie « Ouvert »', cfg.ticketMode === 'thread' ? 'Utilisée par les salons vocaux des tickets' : 'Les nouveaux tickets y sont créés (une catégorie « 2 », « 3 »… est ajoutée quand elle est pleine)'],
            ['waitingCategoryId', 'Catégorie « En attente »', 'Ticket en attente (réponse du membre, info externe…)'],
            ['inProgressCategoryId', 'Catégorie « En cours »', 'Ticket en cours de traitement'],
          ].map(([key, label, hint]) => (
            <Field key={key} label={label} hint={hint}>
              <CategoryPicker value={cfg[key]} onChange={v => set(key, v)}
                categories={categories} loading={discordLoading} />
            </Field>
          ))}
        </div>
        </>}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {[
            ['slaOpenHours', 'Délai « Ouvert » (heures)'],
            ['slaWaitingHours', 'Délai « En attente » (heures)'],
            ['slaInProgressHours', 'Délai « En cours » (heures)'],
          ].map(([key, label]) => (
            <Field key={key} label={label} hint="Temps maximal dans l'étape avant d'être signalé hors délai — 0 = aucun">
              <input type="number" min={0} max={720} value={cfg[key] ?? 0}
                onChange={e => set(key, Math.max(0, Math.min(720, parseInt(e.target.value) || 0)))} className={NUM_INPUT} />
            </Field>
          ))}
        </div>
      </Section>
      {user?.role === 'fondateur' && (
        <Section title="Statuts" description="Des statuts propres à l'espace, en plus de Ouvert, En attente et En cours. Enregistrés à part.">
          <StagesEditor discord={discord} categories={categories} />
        </Section>
      )}
      <Section title="Limites et délais">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Alerte note basse (étoiles)" hint="Une note inférieure ou égale prévient les fondateurs et chefs support — 0 = désactivé">
            <input type="number" min={0} max={4} value={cfg.lowRatingThreshold ?? 2}
              onChange={e => set('lowRatingThreshold', Math.max(0, Math.min(4, parseInt(e.target.value) || 0)))} className={NUM_INPUT} />
          </Field>
          <Field label="Réouverture par le membre (jours)" hint="Bouton « Rouvrir mon ticket » dans le MP de fermeture — 0 = désactivé">
            <input type="number" min={0} max={90} value={cfg.memberReopenDays ?? 7}
              onChange={e => set('memberReopenDays', Math.max(0, Math.min(90, parseInt(e.target.value) || 0)))} className={NUM_INPUT} />
          </Field>
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

        </div>
      )}
      {tab === 'salons' && (
        <div role="tabpanel" id="panel-salons" aria-labelledby="tab-salons" className="space-y-5">
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
          <Field label="Rapport mensuel (PDF)" hint="Envoyé le 1er de chaque mois à 9h — volume, délais, satisfaction, classement du staff">
            <ChannelPicker value={cfg.monthlyReportChannelId} onChange={v => set('monthlyReportChannelId', v)}
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

      <Section title="Statistiques publiques" description="Un message dans un salon de ton choix, mis à jour toutes les heures : tickets résolus, temps de réponse et satisfaction sur 30 jours. Uniquement des chiffres : aucun nom ni sujet.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Salon" hint="Laisse vide pour ne rien publier">
            <ChannelPicker value={cfg.publicStatsChannelId} onChange={v => set('publicStatsChannelId', v)}
              channels={channels} loading={discordLoading} />
          </Field>
          <Field label="Objectif de première réponse (heures)" hint="Le message indique la part des tickets ayant reçu une première réponse dans ce délai">
            <input type="number" min={1} max={168} value={cfg.publicStatsTargetHours ?? 2}
              onChange={e => set('publicStatsTargetHours', Math.max(1, Math.min(168, parseInt(e.target.value) || 1)))} className={NUM_INPUT} />
          </Field>
        </div>
        <PublicStats channelId={cfg.publicStatsChannelId || null} savedChannelId={savedJson ? JSON.parse(savedJson).publicStatsChannelId || null : null} dirty={dirty} />
      </Section>
        </div>
      )}
      {tab === 'fonctions' && (
        <div role="tabpanel" id="panel-fonctions" aria-labelledby="tab-fonctions" className="space-y-5">
      {/* Feature flags */}
      <Section title="Fonctionnalités" description="Active ou désactive les fonctionnalités avancées pour cet espace.">
        <FeatureToggle
          label="Formulaires d'intake"
          hint="Affiche un questionnaire configurable avant l'ouverture du ticket"
          checked={cfg.intakeFormEnabled} onChange={v => set('intakeFormEnabled', v)}
        />
        <FeatureToggle
          label="Prévenir le membre des changements d'étape"
          hint="MP au membre quand son ticket passe en « En cours », « En attente » ou revient en « Ouvert »"
          checked={!!cfg.notifyMemberStage} onChange={v => set('notifyMemberStage', v)}
        />
        <FeatureToggle
          label="Espace membre web"
          hint={`Les membres se connectent avec Discord ou par un lien reçu par e-mail sur ${window.location.origin}/espace pour retrouver leurs tickets, leur statut et l'historique de leurs échanges (jamais les notes internes)`}
          checked={cfg.memberPortalEnabled === undefined || !!cfg.memberPortalEnabled} onChange={v => set('memberPortalEnabled', v)}
        >
          <label className="flex items-start gap-2 mb-3 text-sm text-ink-2">
            <input type="checkbox" checked={!!cfg.portalEmailOpen} onChange={e => set('portalEmailOpen', e.target.checked)} className="mt-1" />
            <span>
              Ouvert à tous par e-mail
              <span className="block text-xs text-ink-4">Toute personne qui se connecte avec un lien reçu par e-mail peut ouvrir un ticket ici, sans compte Discord. Ses messages lui arrivent par l'e-mail de l'instance (Instance → Santé).</span>
            </span>
          </label>
          <PortalBranding cfg={cfg} set={set} />
        </FeatureToggle>
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
          label="Objectifs mensuels"
          hint="Objectif de 50 tickets traités par mois, avec barre de progression sur le dashboard"
          checked={cfg.monthlyGoalsEnabled} onChange={v => set('monthlyGoalsEnabled', v)}
        />
        <FeatureToggle
          label="Leaderboard dashboard"
          hint="Classement staff hebdomadaire / mensuel sur la page d'accueil"
          checked={cfg.leaderboardEnabled !== false} onChange={v => set('leaderboardEnabled', v)}
        />
      </Section>
        </div>
      )}
      {tab === 'horaires' && (
        <div role="tabpanel" id="panel-horaires" aria-labelledby="tab-horaires" className="space-y-5">
          <CalendarsEditor />
          <h2 className="text-sm font-semibold text-ink-1 pt-2">Objectifs SLA</h2>
          <SlaPoliciesEditor />
        </div>
      )}

      {tab === 'catalogue' && (
        <div role="tabpanel" id="panel-catalogue" aria-labelledby="tab-catalogue" className="space-y-5">
          <CatalogEditor />
        </div>
      )}

      {tab === 'regles' && (
        <div role="tabpanel" id="panel-regles" aria-labelledby="tab-regles" className="space-y-5">
          <RulesEditor />
        </div>
      )}

      {tab === 'notifications' && (
        <div role="tabpanel" id="panel-notifications" aria-labelledby="tab-notifications" className="space-y-5">
          <NotificationsEditor />
        </div>
      )}

      {tab === 'integrations' && (
        <div role="tabpanel" id="panel-integrations" aria-labelledby="tab-integrations" className="space-y-5">
      <Section title="Slack et Microsoft Teams">
        <ChatIntegrations />
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

      <Section title="Tickets par e-mail" description="Chaque e-mail reçu sur l'adresse du support ouvre un ticket ; les réponses du staff partent par e-mail. Enregistré à part (mots de passe chiffrés).">
        <EmailSettings />
      </Section>

      <Section title="Widget web" description="Un formulaire de ticket à intégrer sur ton site, sans compte Discord. Enregistré à part.">
        <WidgetSettings />
      </Section>

        </div>
      )}
      {tab === 'sauvegarde' && (
        <div role="tabpanel" id="panel-sauvegarde" aria-labelledby="tab-sauvegarde" className="space-y-5">
      <Section title="Sauvegarde et transfert">
        <ConfigTransfer />
      </Section>

      {discord && (
      <Section title="Importer depuis un autre bot" description="Reprend les tickets ouverts d'un autre bot de tickets : chaque salon de la catégorie choisie devient un ticket de ce bot.">
        <BotImport categories={categories} />
      </Section>
      )}

      <Section title="Historique des modifications" description="Qui a changé quel réglage, avec l'ancienne et la nouvelle valeur. « Revenir à l'état d'avant » annule ce changement et tous les suivants.">
        <ConfigHistory key={historyKey} channels={channels} categories={categories} roles={roles} grades={grades} onRestored={load} />
      </Section>

        </div>
      )}
    </div>
  );
}
