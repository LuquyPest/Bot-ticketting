import React, { useEffect, useState } from 'react';
import { Save, RefreshCw, Plus, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

function Section({ title, children }) {
  return (
    <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-ink-2 border-b border-white/[0.06] pb-3">{title}</h2>
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

const INPUT = "w-full bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors";
const NUM_INPUT = INPUT + " w-32";

export default function Settings() {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newSubject, setNewSubject] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/config').then(r => setCfg(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const set = (key, val) => setCfg(c => ({ ...c, [key]: val }));

  const save = async () => {
    setSaving(true);
    try {
      const snowflake = v => (v === '' ? null : v || null);
      const payload = {
        ticketPrefix: cfg.ticketPrefix,
        welcomeMessage: cfg.welcomeMessage,
        ticketSubjects: cfg.ticketSubjects,
        maxTicketsPerDay: cfg.maxTicketsPerDay,
        inactiveWarningHours: cfg.inactiveWarningHours,
        inactiveHours: cfg.inactiveHours,
        replyRateLimitSeconds: cfg.replyRateLimitSeconds,
        closeLogChannelId:        snowflake(cfg.closeLogChannelId),
        claimLogChannelId:        snowflake(cfg.claimLogChannelId),
        moveLogChannelId:         snowflake(cfg.moveLogChannelId),
        addUserLogChannelId:      snowflake(cfg.addUserLogChannelId),
        removeUserLogChannelId:   snowflake(cfg.removeUserLogChannelId),
        weeklyReportChannelId:    snowflake(cfg.weeklyReportChannelId),
        spamAlertChannelId:       snowflake(cfg.spamAlertChannelId),
        escalationAlertChannelId: snowflake(cfg.escalationAlertChannelId),
        escalationAlertHours:     cfg.escalationAlertHours,
        escalationCloseHours:     cfg.escalationCloseHours,
      };
      await api.patch('/config', payload);
      toast.success('Configuration sauvegardée ! Redémarre le bot pour appliquer les changements.');
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

  const removeSubject = (i) => {
    set('ticketSubjects', cfg.ticketSubjects.filter((_, idx) => idx !== i));
  };

  if (loading) return <div className="p-6 text-ink-3">Chargement...</div>;
  if (!cfg) return <div className="p-6 text-red-400">Impossible de charger la configuration.</div>;

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Paramètres</h1>
          <p className="text-sm text-ink-3 mt-0.5">Modification de config.json — redémarre le bot après sauvegarde</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface transition-colors" title="Recharger">
            <RefreshCw size={16} />
          </button>
          <button onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50">
            <Save size={15} /> {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        </div>
      </div>

      {/* General */}
      <Section title="Général">
        <Field label="Préfixe des tickets" hint="Nom des salons créés (ex: ticket → #ticket-0001)">
          <input type="text" value={cfg.ticketPrefix || ''} onChange={e => set('ticketPrefix', e.target.value)} className={INPUT} />
        </Field>
        <Field label="Message de bienvenue DM" hint="Message envoyé à l'utilisateur lors de la création de son ticket">
          <textarea value={cfg.welcomeMessage || ''} onChange={e => set('welcomeMessage', e.target.value)} rows={3}
            className={INPUT + " resize-none"} />
        </Field>
      </Section>

      {/* Subjects */}
      <Section title="Sujets de ticket">
        <Field label="Menu de sujets" hint="Affiché en DM avant la création du ticket. Laisse vide pour désactiver.">
          <div className="space-y-2">
            {(cfg.ticketSubjects || []).map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="flex-1 bg-surface border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-2">{s}</span>
                <button onClick={() => removeSubject(i)} className="p-1.5 text-ink-4 hover:text-red-400 transition-colors"><X size={14} /></button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="text"
                value={newSubject}
                onChange={e => setNewSubject(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSubject()}
                placeholder="Ajouter un sujet..."
                className={INPUT + " flex-1"}
              />
              <button onClick={addSubject} className="px-3 py-2 rounded-lg bg-surface border border-white/[0.08] text-ink-2 hover:text-ink-1 transition-colors">
                <Plus size={15} />
              </button>
            </div>
          </div>
        </Field>
      </Section>

      {/* Limits */}
      <Section title="Limites et délais">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tickets max / jour" hint="Par utilisateur">
            <input type="number" min={1} max={20} value={cfg.maxTicketsPerDay ?? 3}
              onChange={e => set('maxTicketsPerDay', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
          <Field label="Rate limit /reply (sec)" hint="Délai entre deux réponses staff">
            <input type="number" min={0} max={60} value={cfg.replyRateLimitSeconds ?? 3}
              onChange={e => set('replyRateLimitSeconds', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
          <Field label="Avertissement inactivité (h)" hint="Heures avant avertissement">
            <input type="number" min={1} value={cfg.inactiveWarningHours ?? 24}
              onChange={e => set('inactiveWarningHours', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
          <Field label="Fermeture auto inactivité (h)" hint="Heures avant fermeture auto">
            <input type="number" min={1} value={cfg.inactiveHours ?? 48}
              onChange={e => set('inactiveHours', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
        </div>
      </Section>

      {/* Log channels */}
      <Section title="Salons de logs (IDs Discord)">
        <div className="space-y-3">
          {[
            ['closeLogChannelId',      'Fermeture de ticket'],
            ['claimLogChannelId',      'Claim'],
            ['moveLogChannelId',       'Déplacement'],
            ['addUserLogChannelId',    "Ajout d'utilisateur"],
            ['removeUserLogChannelId', "Retrait d'utilisateur"]
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input type="text" value={cfg[key] || ''} onChange={e => set(key, e.target.value)}
                placeholder="ID du salon Discord" className={INPUT} />
            </Field>
          ))}
        </div>
      </Section>

      {/* Automation channels */}
      <Section title="Salons d'automatisation (IDs Discord)">
        <div className="space-y-3">
          <Field label="Rapport hebdomadaire" hint="Salon où envoyer le rapport + leaderboard staff chaque lundi à 9h">
            <input type="text" value={cfg.weeklyReportChannelId || ''} onChange={e => set('weeklyReportChannelId', e.target.value)}
              placeholder="ID du salon Discord" className={INPUT} />
          </Field>
          <Field label="Alertes anti-spam" hint="Salon notifié quand un utilisateur dépasse la limite quotidienne de tickets">
            <input type="text" value={cfg.spamAlertChannelId || ''} onChange={e => set('spamAlertChannelId', e.target.value)}
              placeholder="ID du salon Discord (défaut : salon fermeture)" className={INPUT} />
          </Field>
          <Field label="Alertes d'escalade" hint="Salon notifié quand un ticket urgent n'a pas de réponse staff depuis le délai configuré">
            <input type="text" value={cfg.escalationAlertChannelId || ''} onChange={e => set('escalationAlertChannelId', e.target.value)}
              placeholder="ID du salon Discord (défaut : salon fermeture)" className={INPUT} />
          </Field>
        </div>
      </Section>

      {/* Escalation */}
      <Section title="Escalade automatique (tickets urgents)">
        <p className="text-xs text-ink-4 -mt-1">Un ticket urgent claim sans réponse staff déclenche une alerte puis une fermeture automatique.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Délai d'alerte (h)" hint="Heures sans réponse avant alerte Discord">
            <input type="number" min={1} max={48} value={cfg.escalationAlertHours ?? 2}
              onChange={e => set('escalationAlertHours', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
          <Field label="Délai de fermeture (h)" hint="Heures sans réponse avant fermeture auto (doit être > délai alerte)">
            <input type="number" min={1} max={168} value={cfg.escalationCloseHours ?? 4}
              onChange={e => set('escalationCloseHours', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
        </div>
      </Section>

    </div>
  );
}
