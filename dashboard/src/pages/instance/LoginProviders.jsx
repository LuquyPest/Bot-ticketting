import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, Copy } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';
import LdapDirectory from '../../components/LdapDirectory';
import SamlSettings from '../../components/SamlSettings';

const INPUT = 'w-full bg-surface border border-overlay/8 rounded-lg px-2.5 py-1.5 text-xs text-ink-1';

// What the owner pastes on the provider's side, and where to find the identifier and the secret
const HELP = {
  google: 'Console Google Cloud → API et services → Identifiants → ID client OAuth (application Web).',
  microsoft: 'Portail Azure → Microsoft Entra ID → Inscriptions d\'applications → Nouvelle inscription (plateforme Web), puis Certificats et secrets.',
  oidc: 'Keycloak, Authentik, Okta, Zitadel… : un client confidentiel avec le flux « authorization code ».',
};

function CopyField({ label, value }) {
  return (
    <div className="text-xs text-ink-3">
      {label}
      <div className="mt-1 flex items-center gap-1.5">
        <code className="flex-1 min-w-0 truncate bg-overlay/4 rounded-lg px-2.5 py-1.5 text-ink-2" translate="no">{value}</code>
        <button type="button" aria-label="Copier" title="Copier" onClick={() => navigator.clipboard?.writeText(value).then(() => toast.success('Copié'))}
          className="p-1.5 rounded-lg border border-overlay/8 text-ink-3 hover:text-ink-1"><Copy size={12} /></button>
      </div>
    </div>
  );
}

// Instance → Connexion → Boîtes e-mail: the OAuth2 applications the spaces use to connect their
// support mailbox with Google or Microsoft (utils/mailOAuth.js, v5.0)
const MAIL_HELP = {
  google: 'Console Google Cloud : active l\'API Gmail, crée un ID client OAuth (application Web). Pour Google Workspace, choisis l\'audience « Interne » : en mode « Test », Google coupe l\'accès au bout de 7 jours.',
  microsoft: 'Portail Azure → Microsoft Entra ID → Inscriptions d\'applications (plateforme Web), avec les autorisations déléguées IMAP.AccessAsUser.All, SMTP.Send et offline_access d\'Office 365 Exchange Online. SMTP authentifié doit être permis sur la boîte.',
};
function MailboxApps() {
  const [m, setM] = useState(null);
  const [secrets, setSecrets] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/instance/mail-oauth').then(r => setM(r.data)).catch(() => setM(false)); }, []);
  if (!m) return null;
  const set = (k, f, v) => setM(x => ({ ...x, [k]: { ...x[k], [f]: v } }));
  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(['google', 'microsoft'].map(k => [k, { clientId: m[k].clientId, tenant: m[k].tenant, clientSecret: secrets[k] || '' }]));
      setM((await api.put('/instance/mail-oauth', body)).data); setSecrets({});
      toast.success('Applications e-mail enregistrées');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <section className="space-y-3" aria-labelledby="mail-apps">
      <div>
        <h2 id="mail-apps" className="text-base font-bold text-ink-1">Boîtes e-mail</h2>
        <p className="text-sm text-ink-3 mt-1">Pour que les espaces connectent leur boîte de support Gmail ou Microsoft 365 sans mot de passe d'application (Paramètres → Intégrations → Tickets par e-mail). L'application se déclare une fois ici ; chaque espace connecte ensuite sa boîte.</p>
      </div>
      {[['google', 'Google (Gmail, Workspace)'], ['microsoft', 'Microsoft 365 (Outlook)']].map(([k, label]) => (
        <div key={k} className="glass-dark rounded-2xl border border-overlay/8 px-5 py-4 space-y-3">
          <p className="text-sm font-semibold text-ink-1">{label}{m[k].configured ? <span className="text-emerald-400 text-xs font-normal"> · prête</span> : <span className="text-ink-4 text-xs font-normal"> · non déclarée</span>}</p>
          <p className="text-xs text-ink-3">{MAIL_HELP[k]}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-xs text-ink-3">Identifiant de l'application (client ID)
              <input value={m[k].clientId || ''} onChange={e => set(k, 'clientId', e.target.value)} className={`${INPUT} mt-1`} autoComplete="off" />
            </label>
            <label className="block text-xs text-ink-3">Secret de l'application
              <input type="password" autoComplete="new-password" value={secrets[k] || ''} onChange={e => setSecrets(x => ({ ...x, [k]: e.target.value }))}
                placeholder={m[k].secretSet ? '•••••••• (inchangé)' : ''} className={`${INPUT} mt-1`} />
            </label>
            {k === 'microsoft' && (
              <label className="block text-xs text-ink-3">Annuaire (tenant)
                <input value={m[k].tenant || ''} onChange={e => set(k, 'tenant', e.target.value)} placeholder="common" className={`${INPUT} mt-1`} autoComplete="off" />
              </label>
            )}
          </div>
          <CopyField label="Adresse de retour à déclarer chez le fournisseur" value={m[k].callbackUrl} />
        </div>
      ))}
      <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-2">
        {busy && <Loader2 size={14} className="animate-spin" />} Enregistrer les applications e-mail
      </button>
    </section>
  );
}

// Instance → Connexion: the sign-in providers of the instance (v4). E-mail and password is always
// available; the server refuses a change that would leave the owner without a way to sign in.
export default function LoginProviders() {
  const [s, setS] = useState(null);
  const [secrets, setSecrets] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/instance/login-providers').then(r => setS(r.data)).catch(() => setS(false)); }, []);
  if (s === null) return <div className="p-6"><Loader2 size={18} className="animate-spin text-ink-4" /></div>;
  if (s === false) return <p className="p-6 text-sm text-ink-4">Indisponible.</p>;
  const set = (k, field, v) => setS(x => ({ ...x, [k]: { ...x[k], [field]: v } }));
  const save = async () => {
    setBusy(true);
    try {
      const body = {};
      for (const k of ['discord', 'google', 'microsoft', 'oidc']) {
        const { enabled, clientId, tenant, name, issuer } = s[k];
        body[k] = k === 'discord' ? { enabled } : { enabled, clientId, tenant, name, issuer, clientSecret: secrets[k] || '' };
      }
      const r = await api.put('/instance/login-providers', body);
      setS(r.data); setSecrets({});
      toast.success('Moyens de connexion enregistrés');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const field = (k, label, key, props = {}) => (
    <label className="block text-xs text-ink-3">{label}
      <input value={s[k][key] ?? ''} onChange={e => set(k, key, e.target.value)} className={`${INPUT} mt-1`} autoComplete="off" {...props} />
    </label>
  );
  const secret = k => (
    <label className="block text-xs text-ink-3">Secret de l'application
      <input type="password" autoComplete="new-password" value={secrets[k] || ''} onChange={e => setSecrets(x => ({ ...x, [k]: e.target.value }))}
        placeholder={s[k].secretSet ? '•••••••• (inchangé)' : ''} className={`${INPUT} mt-1`} />
    </label>
  );
  const toggle = (k, label) => (
    <label className="flex items-center gap-2 text-sm font-semibold text-ink-1">
      <input type="checkbox" checked={!!s[k].enabled} onChange={e => set(k, 'enabled', e.target.checked)} className="accent-primary" />
      {label}
      {s[k].enabled && s[k].configured ? <span className="text-emerald-400 text-xs font-normal">· activé</span> : <span className="text-ink-4 text-xs font-normal">· désactivé</span>}
    </label>
  );
  const card = 'glass-dark rounded-2xl border border-overlay/8 px-5 py-4 space-y-3';

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink-1 inline-flex items-center gap-2"><KeyRound size={18} aria-hidden="true" />Connexion</h1>
        <p className="text-sm text-ink-3 mt-1">
          Les moyens de se connecter au dashboard. L'adresse e-mail et le mot de passe restent toujours possibles. Un compte Google, Microsoft ou OpenID Connect
          se relie à un compte existant par son adresse e-mail si le fournisseur la garantit, ou depuis Profil → Connexion. Personne ne reçoit de compte en se connectant :
          les comptes viennent des invitations.
        </p>
      </div>

      <div className={card}>
        {toggle('discord', 'Discord')}
        <p className="text-xs text-ink-3">La connexion avec un compte Discord. Elle est distincte de l'intégration Discord : le bot, les MP et les salons continuent sans elle, et l'espace membre garde sa connexion Discord.</p>
        {!s.discordApp && <p className="text-xs text-amber-400">Aucune application Discord n'est configurée sur cette instance : ce moyen reste indisponible.</p>}
      </div>

      {[['google', 'Google'], ['microsoft', 'Microsoft'], ['oidc', 'OpenID Connect']].map(([k, label]) => (
        <div key={k} className={card}>
          {toggle(k, k === 'oidc' && s.oidc.name ? s.oidc.name : label)}
          <p className="text-xs text-ink-3">{HELP[k]}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {k === 'oidc' && field(k, 'Nom affiché', 'name', { placeholder: 'Keycloak', maxLength: 40 })}
            {k === 'oidc' && field(k, 'Adresse du fournisseur (issuer)', 'issuer', { placeholder: 'https://sso.example.com/realms/equipe' })}
            {field(k, 'Identifiant de l\'application (client ID)', 'clientId')}
            {secret(k)}
            {k === 'microsoft' && field(k, 'Annuaire (tenant)', 'tenant', { placeholder: 'common' })}
          </div>
          <CopyField label="Adresse de retour à déclarer chez le fournisseur" value={s[k].callbackUrl} />
          {k === 'microsoft' && (
            <p className="text-xs text-ink-4">Microsoft ne garantit pas l'adresse e-mail de ses comptes : chacun relie Microsoft depuis Profil → Connexion, sauf si l'application renvoie la revendication facultative <code translate="no">xms_edov</code>.</p>
          )}
        </div>
      ))}

      <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-2">
        {busy && <Loader2 size={14} className="animate-spin" />} Enregistrer
      </button>

      <LdapDirectory />

      <SamlSettings />

      <MailboxApps />
    </div>
  );
}
