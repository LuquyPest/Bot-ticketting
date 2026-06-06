import React, { useEffect, useState } from 'react';
import { Save, RefreshCw, Plus, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

function Section({ title, children }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-slate-300 border-b border-slate-800 pb-3">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-sm text-slate-300 font-medium block mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-600 mb-2">{hint}</p>}
      {children}
    </div>
  );
}

const INPUT = "w-full bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors";
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
  const setDash = (key, val) => setCfg(c => ({ ...c, dashboard: { ...c.dashboard, [key]: val } }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ticketPrefix: cfg.ticketPrefix,
        welcomeMessage: cfg.welcomeMessage,
        ticketSubjects: cfg.ticketSubjects,
        maxTicketsPerDay: cfg.maxTicketsPerDay,
        inactiveWarningHours: cfg.inactiveWarningHours,
        inactiveHours: cfg.inactiveHours,
        replyRateLimitSeconds: cfg.replyRateLimitSeconds,
        closeLogChannelId: cfg.closeLogChannelId,
        claimLogChannelId: cfg.claimLogChannelId,
        moveLogChannelId: cfg.moveLogChannelId,
        addUserLogChannelId: cfg.addUserLogChannelId,
        removeUserLogChannelId: cfg.removeUserLogChannelId,
        dashboard: {
          port: cfg.dashboard?.port,
          authMethods: cfg.dashboard?.authMethods,
          allowedRoleId: cfg.dashboard?.allowedRoleId
        }
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

  if (loading) return <div className="p-6 text-slate-500">Chargement...</div>;
  if (!cfg) return <div className="p-6 text-red-400">Impossible de charger la configuration.</div>;

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Paramètres</h1>
          <p className="text-sm text-slate-500 mt-0.5">Modification de config.json — redémarre le bot après sauvegarde</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:text-slate-100 hover:bg-slate-800 transition-colors" title="Recharger">
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
                <span className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300">{s}</span>
                <button onClick={() => removeSubject(i)} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors"><X size={14} /></button>
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
              <button onClick={addSubject} className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-100 transition-colors">
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
            ['closeLogChannelId', 'Fermeture de ticket'],
            ['claimLogChannelId', 'Claim'],
            ['moveLogChannelId', 'Déplacement'],
            ['addUserLogChannelId', 'Ajout d\'utilisateur'],
            ['removeUserLogChannelId', 'Retrait d\'utilisateur']
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input type="text" value={cfg[key] || ''} onChange={e => set(key, e.target.value)}
                placeholder="ID du salon Discord" className={INPUT} />
            </Field>
          ))}
        </div>
      </Section>

      {/* Dashboard config */}
      <Section title="Dashboard">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Port" hint="Port d'écoute du dashboard">
            <input type="number" value={cfg.dashboard?.port ?? 3001} onChange={e => setDash('port', parseInt(e.target.value))} className={NUM_INPUT} />
          </Field>
          <Field label="Rôle autorisé" hint="ID du rôle Discord pour accéder via OAuth">
            <input type="text" value={cfg.dashboard?.allowedRoleId || ''} onChange={e => setDash('allowedRoleId', e.target.value)}
              placeholder="ID du rôle" className={INPUT} />
          </Field>
        </div>
        <Field label="Méthodes d'authentification">
          <div className="flex gap-3">
            {['discord', 'password'].map(method => (
              <label key={method} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.dashboard?.authMethods?.includes(method) ?? true}
                  onChange={e => {
                    const methods = cfg.dashboard?.authMethods || ['discord', 'password'];
                    if (e.target.checked) setDash('authMethods', [...new Set([...methods, method])]);
                    else setDash('authMethods', methods.filter(m => m !== method));
                  }}
                  className="w-4 h-4 accent-indigo-600"
                />
                <span className="text-sm text-slate-300 capitalize">{method}</span>
              </label>
            ))}
          </div>
        </Field>
      </Section>
    </div>
  );
}
