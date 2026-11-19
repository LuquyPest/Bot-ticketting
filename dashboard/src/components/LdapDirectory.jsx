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
  const [spaces, setSpaces] = useState([]);
  const [sync, setSync] = useState(null);
  useEffect(() => {
    api.get('/instance/ldap').then(r => setS(r.data)).catch(() => setS(false));
    api.get('/instance/guilds').then(r => setSpaces((Array.isArray(r.data) ? r.data : []).filter(g => g.status === 'active'))).catch(() => {});
    api.get('/instance/ldap/sync').then(r => setSync(r.data)).catch(() => {});
  }, []);
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
  const syncNow = async () => {
    setBusy(true);
    try { const r = await api.post('/instance/ldap/sync'); setSync(r.data); toast.success('Annuaire synchronisé'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const toggleIn = (k, id) => set(k, (s[k] || []).includes(id) ? s[k].filter(x => x !== id) : [...(s[k] || []), id]);
  const spaceChips = k => (
    <span className="inline-flex flex-wrap gap-1" role="group" aria-label="Espaces">
      {spaces.map(g => {
        const on = (s[k] || []).includes(g.guild_id);
        return <button key={g.guild_id} type="button" aria-pressed={on} onClick={() => toggleIn(k, g.guild_id)}
          className={`px-2 py-0.5 rounded-md text-[11px] border ${on ? 'bg-primary/15 text-primary-light border-primary/40' : 'border-overlay/8 text-ink-3 hover:text-ink-1'}`}>{g.guild_name || g.guild_id}</button>;
      })}
    </span>
  );
  const lastSync = sync?.at ? Object.values(sync.results || {}).reduce((a, r) => ({ created: a.created + (r.created || 0), updated: a.updated + (r.updated || 0) }), { created: 0, updated: 0 }) : null;
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
      <div className="border-t border-overlay/6 pt-3 space-y-2 text-xs text-ink-2">
        <p className="font-semibold text-ink-1">Synchronisation des contacts</p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="ldap-sync">Fréquence</label>
          <select id="ldap-sync" value={s.syncInterval || 'off'} onChange={e => set('syncInterval', e.target.value)} className="bg-surface border border-overlay/8 rounded-lg px-2 py-1 text-xs text-ink-1">
            <option value="off">à la main</option><option value="hourly">chaque heure</option><option value="daily">chaque jour</option>
          </select>
          <span>vers</span>{spaceChips('syncSpaces')}
        </div>
        <p className="text-[11px] text-ink-3">Les personnes de l'annuaire deviennent des contacts de ces espaces, rattachés à leur organisation ; les fiches déjà importées sont mises à jour (nom, organisation).</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={syncNow} disabled={busy} className="px-2.5 py-1 rounded-lg border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Synchroniser maintenant</button>
          {sync?.at && <span role="status" className="text-[11px] text-ink-3">{sync.results?.error ? `Dernière synchronisation en échec : ${sync.results.error}` : `Dernière synchronisation : ${new Date(sync.at).toLocaleString()} · ${sync.people} personne(s) · ${lastSync.created} créée(s), ${lastSync.updated} mise(s) à jour`}</span>}
        </div>
        <p className="font-semibold text-ink-1 pt-2">Comptes</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={!!s.autoCreate} onChange={e => set('autoCreate', e.target.checked)} className="accent-primary mt-0.5" />
          <span>Créer un compte à la première connexion d'un membre du groupe autorisé, sans invitation, avec le rôle support dans :</span></label>
        {s.autoCreate && <div className="pl-6">{spaceChips('provisionSpaces')}</div>}
        <p className="text-[11px] text-ink-4">Désactivé par défaut. Exige un groupe autorisé ; une adresse déjà utilisée par un compte n'en reçoit pas un second. Chaque compte créé est inscrit au journal de l'instance.</p>
      </div>
      <div className="flex gap-2 items-center">
        <button type="button" onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-2">{busy && <Loader2 size={14} className="animate-spin" />} Enregistrer l'annuaire</button>
        <button type="button" onClick={run} disabled={busy} className="px-3 py-2 rounded-lg text-sm border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Tester</button>
        {test && <span role="status" className={`text-xs ${test.ok ? 'text-emerald-400' : 'text-red-300'}`}>{test.ok ? `Connexion réussie : ${test.people >= 1000 ? '1000 ou plus' : test.people} personne(s) trouvée(s)` : `Échec : ${test.error}`}</span>}
      </div>
    </div>
  );
}
