import React, { useCallback, useEffect, useState } from 'react';
import { History, RotateCcw, Loader2, ArrowRight } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../utils/confirmToast';
import Pagination from './Pagination';
import { fmtDate } from '../utils/format';

export const FIELD_LABELS = {
  ticketPrefix: 'Préfixe des tickets', welcomeMessage: 'Message de bienvenue', closeMessage: 'Message de fermeture',
  ticketSubjects: 'Sujets de ticket', maxTicketsPerDay: 'Tickets max par jour', inactiveWarningHours: 'Avertissement d\'inactivité (h)',
  inactiveHours: 'Fermeture pour inactivité (h)', replyRateLimitSeconds: 'Délai entre deux messages (s)',
  ticketCategoryId: 'Catégorie des tickets', waitingCategoryId: 'Catégorie « en attente »', inProgressCategoryId: 'Catégorie « en cours »',
  slaOpenHours: 'Délai — ouvert (h)', slaWaitingHours: 'Délai — en attente (h)', slaInProgressHours: 'Délai — en cours (h)',
  supportRoleIds: 'Rôles support', chiefRoleIds: 'Rôles chef support', supportGradeId: 'Grade des rôles support', chiefGradeId: 'Grade des rôles chef',
  closeLogChannelId: 'Salon — fermetures', claimLogChannelId: 'Salon — prises en charge', moveLogChannelId: 'Salon — déplacements',
  addUserLogChannelId: 'Salon — ajouts de membres', removeUserLogChannelId: 'Salon — retraits de membres',
  weeklyReportChannelId: 'Salon — rapport hebdomadaire', monthlyReportChannelId: 'Salon — rapport mensuel',
  spamAlertChannelId: 'Salon — alertes spam', escalationAlertChannelId: 'Salon — escalades',
  escalationAlertHours: 'Escalade — alerte (h)', escalationCloseHours: 'Escalade — fermeture (h)',
  embedColor: 'Couleur des embeds', botLanguage: 'Langue du bot', require2fa: '2FA obligatoire',
  memberReopenDays: 'Réouverture par le membre (jours)', notifyMemberStage: 'Membre prévenu des changements d\'étape',
  lowRatingThreshold: 'Seuil de note basse', memberPortalEnabled: 'Espace membre web', botDisplayName: 'Nom du bot', webhookUrl: 'URL du webhook', webhookSecret: 'Secret du webhook',
  intakeFormEnabled: 'Formulaire d\'ouverture', staffReminderEnabled: 'Rappels au staff', staffReminderHours: 'Rappel au staff (h)',
  userInactiveEnabled: 'Membre inactif', userInactiveWarnHours: 'Membre inactif — avertissement (h)', userInactiveCloseHours: 'Membre inactif — fermeture (h)',
  internalNotesEnabled: 'Notes internes', monthlyGoalsEnabled: 'Objectifs mensuels', leaderboardEnabled: 'Classement',
  webhooksEnabled: 'Webhooks', webhookEvents: 'Événements du webhook', apiKeysEnabled: 'Clés API',
  subjectWelcomeMessages: 'Messages de bienvenue par sujet', ipAllowlist: 'Adresses IP autorisées',
};
const SOURCE = { settings: null, import: 'Import', restore: 'Restauration' };
const CHANNEL_KEYS = /ChannelId$|CategoryId$/;
const LANG = { fr: 'Français', en: 'Anglais', auto: 'Automatique' };
const TWO_FA = { none: 'Non', founders: 'Fondateurs', staff: 'Tout le staff' };

// Short, readable rendering of a setting value (names instead of Discord ids)
function useFormatter({ channels, categories, roles, grades }) {
  return (key, v) => {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '—';
    if (CHANNEL_KEYS.test(key)) {
      const c = [...channels, ...categories].find(x => x.id === v);
      return c ? `#${c.name}` : `salon ${v}`;
    }
    if (key === 'supportRoleIds' || key === 'chiefRoleIds') return v.map(id => `@${roles.find(r => r.id === id)?.name || id}`).join(', ');
    if (key === 'supportGradeId' || key === 'chiefGradeId') return grades.find(g => g.id === v)?.name || `grade ${v}`;
    if (key === 'botLanguage') return LANG[v] || v;
    if (key === 'require2fa') return TWO_FA[v] || v;
    if (typeof v === 'boolean' || ((v === 0 || v === 1) && /Enabled$|^notify/.test(key))) return v ? 'Activé' : 'Désactivé';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') return `${Object.keys(v).length} élément(s)`;
    const s = String(v);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  };
}

export default function ConfigHistory({ channels = [], categories = [], roles = [], grades = [], onRestored }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(null);
  const fmt = useFormatter({ channels, categories, roles, grades });

  const load = useCallback(() => {
    api.get('/config/history', { params: { page } }).then(r => setData(r.data)).catch(() => setData({ entries: [], pages: 0, total: 0 }));
  }, [page]);
  useEffect(load, [load]);

  const restore = async (entry, index) => {
    const later = (page - 1) * 30 + index; // more recent entries, undone too
    if (!await confirmToast(`Revenir à l'état d'avant ce changement ?${later ? ` Les ${later} modification(s) plus récente(s) seront aussi annulées.` : ''}`)) return;
    setBusy(entry.id);
    try {
      const { data: r } = await api.post(`/config/history/${entry.id}/restore`);
      if (r.message) toast(r.message);
      else toast.success(`Paramètres restaurés (${r.restored.length} réglage(s))${r.skipped?.length ? ' — le secret du webhook est laissé tel quel' : ''}`);
      setPage(1);
      load();
      onRestored?.();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(null);
  };

  if (!data) return <div className="h-16 rounded-xl bg-overlay/2.5 animate-pulse" />;
  if (!data.entries.length) return <p className="text-sm text-ink-3">Aucune modification enregistrée pour l'instant.</p>;

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {data.entries.map((e, i) => (
          <li key={e.id} className="rounded-xl border border-overlay/6 bg-overlay/2 p-3.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <History size={12} className="text-ink-4" />
              <span className="text-ink-1 font-medium">{e.actor_tag}</span>
              <span className="text-ink-4">{fmtDate(e.created_at)}</span>
              {SOURCE[e.source] && <span className="px-1.5 py-0.5 rounded-md bg-overlay/6 text-ink-2 text-[10px] font-semibold">{SOURCE[e.source]}</span>}
              <button onClick={() => restore(e, i)} disabled={busy !== null}
                className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-overlay/8 text-ink-3
                           hover:text-ink-1 hover:border-overlay/15 disabled:opacity-50 transition-all">
                {busy === e.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                Revenir à l'état d'avant
              </button>
            </div>
            <ul className="mt-2.5 space-y-1">
              {Object.entries(e.changes).map(([k, c]) => (
                <li key={k} className="text-xs flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-ink-2 font-medium">{FIELD_LABELS[k] || k}</span>
                  {c.secret ? <span className="text-ink-4 italic">modifié (valeur masquée)</span> : (
                    <>
                      <span className="text-ink-3 line-through decoration-ink-4/60 break-all">{fmt(k, c.before)}</span>
                      <ArrowRight size={11} className="text-ink-4 shrink-0" />
                      <span className="text-ink-1 break-all">{fmt(k, c.after)}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <Pagination page={page} pages={data.pages} onChange={setPage} />
    </div>
  );
}
