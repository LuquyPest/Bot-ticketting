import React, { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Paramètres → Intégrations → Jira, GitHub, GitLab (v7, utils/devIntegrations.js)
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const LABELS = { github: 'GitHub', gitlab: 'GitLab', jira: 'Jira' };
const HINTS = {
  github: 'Jeton à grain fin avec l\'accès « Issues : lecture et écriture » au dépôt. Webhook : « Issues », type application/json, avec le secret ci-dessous.',
  gitlab: 'Jeton de projet ou personnel avec la portée « api ». Webhook : « Issues events », jeton secret = le secret ci-dessous.',
  jira: 'Jeton d\'API Atlassian du compte (id.atlassian.com → Sécurité). Webhook : événements « issue mis à jour », à l\'adresse ci-dessous.',
};

function Provider({ k, s, onSaved }) {
  const [f, setF] = useState({ ...s, token: '' });
  const set = (x, v) => setF(o => ({ ...o, [x]: v }));
  const save = async (extra = {}) => { try { onSaved((await api.put(`/dev-integrations/${k}`, { ...f, ...extra })).data); setF(o => ({ ...o, token: '' })); toast.success(`${LABELS[k]} enregistré`); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const field = (x, label, ph) => <input value={f[x] || ''} onChange={e => set(x, e.target.value)} placeholder={ph} aria-label={label} className={INPUT} />;
  return (
    <div className="rounded-xl border border-overlay/8 p-3 space-y-2">
      <label className="flex items-center gap-2 text-sm text-ink-1"><input type="checkbox" checked={!!f.enabled} onChange={e => set('enabled', e.target.checked)} className="accent-primary" />{LABELS[k]}</label>
      {f.enabled && <>
        <div className="grid gap-2 sm:grid-cols-2">
          {k === 'github' && field('repo', 'Dépôt GitHub', 'propriétaire/dépôt')}
          {k === 'gitlab' && field('baseUrl', 'Adresse de GitLab', 'https://gitlab.com')}
          {k === 'gitlab' && field('project', 'Projet GitLab', 'groupe/projet')}
          {k === 'jira' && field('baseUrl', 'Adresse de Jira', 'https://societe.atlassian.net')}
          {k === 'jira' && field('email', 'Adresse e-mail du compte Jira', 'support@exemple.fr')}
          {k === 'jira' && field('project', 'Clé du projet Jira', 'SUP')}
          {k === 'jira' && field('issueType', 'Type de ticket Jira', 'Task')}
          <input type="password" autoComplete="off" value={f.token} onChange={e => set('token', e.target.value)} placeholder={s.hasToken ? 'Jeton enregistré (laisser vide pour le garder)' : 'Jeton d\'accès'} aria-label={`Jeton ${LABELS[k]}`} className={INPUT} />
        </div>
        <p className="text-[11px] text-ink-4">{HINTS[k]}</p>
        {s.webhookUrl && (
          <p className="text-[11px] text-ink-3 break-all">Webhook : <code className="px-1 rounded bg-overlay/6" translate="no">{s.webhookUrl}</code>
            {k !== 'jira' && <span>{` · secret : la dernière partie de l'adresse`}</span>}
            <button type="button" onClick={() => save({ newSecret: true })} className="ml-2 underline hover:text-ink-1">Nouveau secret</button></p>
        )}
      </>}
      <button type="button" onClick={() => save()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white">Enregistrer</button>
    </div>
  );
}

export default function DevIntegrationsSettings() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get('/dev-integrations').then(r => setS(r.data?.github ? r.data : false)).catch(() => setS(false)); }, []);
  if (!s) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-3 inline-flex items-center gap-1.5"><GitBranch size={13} aria-hidden="true" />Depuis un ticket, créer ou lier une issue ; son état s'affiche sur le ticket et une note interne dit quand elle est fermée.</p>
      {['github', 'gitlab', 'jira'].map(k => <Provider key={k} k={k} s={s[k]} onSaved={setS} />)}
    </div>
  );
}
