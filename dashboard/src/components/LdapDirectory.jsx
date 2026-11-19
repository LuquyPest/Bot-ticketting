import React, { useEffect, useState } from 'react';
import { Loader2, Network } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Instance → Connexion → Annuaire LDAP / Active Directory (utils/ldapDirectory.js, v5.7)
const INPUT = 'w-full bg-surface border border-overlay/8 rounded-lg px-2.5 py-1.5 text-xs text-ink-1';
const PRESETS = {
  openldap: { loginAttr: 'uid', userFilter: '(objectClass=person)', nameAttr: 'displayName,cn', orgAttr: 'o,company', contactsFilter: '(&(objectClass=person)(mail=*))' },
  ad: { loginAttr: 'sAMAccountName', userFilter: '(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))', nameAttr: 'displayName,cn', orgAttr: 'company', contactsFilter: '(&(objectCategory=person)(objectClass=user)(mail=*))' },
};

export default function LdapDirectory() {
  const [s, setS] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);
  useEffect(() => { api.get('/instance/ldap').then(r => setS(r.data)).catch(() => setS(false)); }, []);
  if (!s) return null;
  const set = (k, v) => setS(x => ({ ...x, [k]: v }));
  const body = () => ({ ...s, bindPassword: password || undefined });
  const save = async () => {
    setBusy(true);
    try { const r = await api.put('/instance/ldap', body()); setS(r.data); setPassword(''); toast.success('Annuaire enregistré'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const run = async () => {
    setBusy(true); setTest(null);
    try { setTest((await api.post('/instance/ldap/test', body())).data); }
    catch (err) { setTest({ ok: false, error: err.response?.data?.error || 'Erreur' }); }
    setBusy(false);
  };
  const field = (label, k, props = {}) => (
    <label className="text-xs text-ink-3 block">{label}
      <input value={s[k] || ''} onChange={e => set(k, e.target.value)} className={`${INPUT} mt-1`} translate="no" {...props} />
    </label>
  );
  return (
    <div className="glass-dark rounded-2xl border border-overlay/8 px-5 py-4 space-y-3">
      <label className="flex items-center gap-2 text-sm font-semibold text-ink-1">
        <input type="checkbox" checked={!!s.enabled} onChange={e => set('enabled', e.target.checked)} className="accent-primary" />
        <Network size={14} aria-hidden="true" /> Annuaire LDAP / Active Directory
        {s.enabled && s.configured ? <span className="text-emerald-400 text-xs font-normal">· activé</span> : <span className="text-ink-4 text-xs font-normal">· désactivé</span>}
      </label>
      <p className="text-xs text-ink-3">Le staff se connecte avec son identifiant et son mot de passe de l'annuaire. Le compte de l'annuaire se relie au compte qui a la même adresse e-mail confirmée ; les comptes viennent toujours des invitations. Les fondateurs peuvent aussi importer les contacts et organisations de l'annuaire (Paramètres → Sauvegarde).</p>
      <div className="flex gap-2 text-xs">
        <span className="text-ink-3 self-center">Valeurs habituelles :</span>
        <button type="button" onClick={() => setS(x => ({ ...x, ...PRESETS.openldap }))} className="px-2 py-1 rounded-lg border border-overlay/8 text-ink-2 hover:text-ink-1">OpenLDAP</button>
        <button type="button" onClick={() => setS(x => ({ ...x, ...PRESETS.ad }))} className="px-2 py-1 rounded-lg border border-overlay/8 text-ink-2 hover:text-ink-1">Active Directory</button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {field('Nom affiché sur la page de connexion', 'label', { placeholder: 'Annuaire', maxLength: 40 })}
        {field('Adresse du serveur', 'url', { placeholder: 'ldaps://annuaire.example.com:636' })}
        {field('Compte de service (DN)', 'bindDn', { placeholder: 'cn=datick,ou=services,dc=example,dc=com' })}
        <label className="text-xs text-ink-3 block">Mot de passe du compte de service
          <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder={s.passwordSet ? '•••••••• (inchangé)' : ''} className={`${INPUT} mt-1`} />
        </label>
        {field('Base de recherche', 'baseDn', { placeholder: 'ou=people,dc=example,dc=com' })}
        {field('Attribut de l\'identifiant', 'loginAttr', { placeholder: 'uid' })}
        {field('Filtre des personnes', 'userFilter')}
        {field('Groupe autorisé (DN, facultatif)', 'group', { placeholder: 'cn=support,ou=groups,dc=example,dc=com' })}
        {field('Attribut de l\'adresse e-mail', 'mailAttr')}
        {field('Attributs du nom', 'nameAttr')}
        {field('Attributs de l\'organisation', 'orgAttr')}
        {field('Base des contacts (facultatif)', 'contactsBase')}
        {field('Filtre des contacts', 'contactsFilter')}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-ink-2">
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!s.startTls} onChange={e => set('startTls', e.target.checked)} className="accent-primary" /> StartTLS (avec ldap://)</label>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={s.tlsVerify !== false} onChange={e => set('tlsVerify', e.target.checked)} className="accent-primary" /> Vérifier le certificat du serveur</label>
      </div>
      {s.tlsVerify === false && <p className="text-xs text-amber-400">Sans vérification, quelqu'un placé sur le réseau peut se faire passer pour l'annuaire et lire les mots de passe. Colle plutôt le certificat de ton autorité ci-dessous.</p>}
      <label className="text-xs text-ink-3 block">Certificat de l'autorité (PEM, si l'annuaire utilise une autorité interne)
        <textarea value={s.ca || ''} onChange={e => set('ca', e.target.value)} rows={3} placeholder="-----BEGIN CERTIFICATE-----" className={`${INPUT} mt-1 font-mono`} translate="no" />
      </label>
      <div className="flex gap-2 items-center">
        <button type="button" onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-2">{busy && <Loader2 size={14} className="animate-spin" />} Enregistrer l'annuaire</button>
        <button type="button" onClick={run} disabled={busy} className="px-3 py-2 rounded-lg text-sm border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Tester</button>
        {test && <span role="status" className={`text-xs ${test.ok ? 'text-emerald-400' : 'text-red-300'}`}>{test.ok ? `Connexion réussie : ${test.people >= 1000 ? '1000 ou plus' : test.people} personne(s) trouvée(s)` : `Échec : ${test.error}`}</span>}
      </div>
    </div>
  );
}
