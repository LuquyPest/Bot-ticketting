import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Instance → Connexion → SAML 2.0 (v7, utils/saml.js): the identity provider of the organisation
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';

export default function SamlSettings() {
  const [s, setS] = useState(null);
  const [cert, setCert] = useState('');
  const [spKey, setSpKey] = useState('');
  const [spCert, setSpCert] = useState('');
  const [diag, setDiag] = useState(null);
  const diagnose = () => api.get('/instance/saml/diagnose').then(r => setDiag(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur'));
  // Sign-in test (v8): opens the provider in a new tab; what it sends back is shown there, no session
  const testLogin = async () => {
    try { const { data } = await api.post('/instance/saml/test-login'); window.open(data.url, '_blank', 'noopener'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  useEffect(() => { api.get('/instance/saml').then(r => setS(r.data)).catch(() => setS(false)); }, []);
  if (!s) return null;
  const set = (k, v) => setS(x => ({ ...x, [k]: v }));
  const save = async () => {
    try { const r = await api.put('/instance/saml', { ...s, idpCert: cert, spKey, spCert }); setS(r.data); setCert(''); setSpKey(''); setSpCert(''); toast.success('SAML enregistré'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const copy = v => navigator.clipboard?.writeText(v).then(() => toast.success('Copié')).catch(() => {});
  const field = (k, label, ph) => <label className="block text-[11px] text-ink-3">{label}<input value={s[k] || ''} onChange={e => set(k, e.target.value)} placeholder={ph} className={`${INPUT} mt-0.5`} /></label>;
  return (
    <section className="bg-surface-card border border-overlay/6 rounded-2xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-ink-1 inline-flex items-center gap-2"><ShieldCheck size={15} aria-hidden="true" />SAML 2.0</h2>
      <p className="text-xs text-ink-3">Connexion par le fournisseur d'identité de l'organisation (Entra ID, Okta, ADFS, Keycloak…). La réponse et l'assertion doivent être signées ; une personne se connecte au compte qui a la même adresse vérifiée, sans création de compte.</p>
      <label className="flex items-center gap-2 text-sm text-ink-1"><input type="checkbox" checked={!!s.enabled} onChange={e => set('enabled', e.target.checked)} className="accent-primary" />Activer la connexion SAML</label>
      <div className="grid gap-2 sm:grid-cols-2">
        {field('name', 'Nom affiché sur la page de connexion', 'Entra ID')}
        {field('entryPoint', 'Adresse de connexion du fournisseur (SSO, HTTP-Redirect)', 'https://login.example.com/saml2')}
        {field('idpIssuer', 'Identifiant du fournisseur (entity ID, facultatif)', 'https://sts.example.com/…')}
        {field('emailAttribute', 'Attribut de l\'adresse e-mail', 'email')}
        {field('nameAttribute', 'Attribut du nom', 'displayName')}
        {field('groupAttribute', 'Attribut des groupes', 'groups')}
        {field('group', 'Groupe autorisé (facultatif)', 'support-datick')}
      </div>
      <label className="block text-[11px] text-ink-3">{s.idpCertSet ? 'Certificat de signature du fournisseur (enregistré ; coller un nouveau pour le remplacer)' : 'Certificat de signature du fournisseur (PEM)'}
        <textarea value={cert} onChange={e => setCert(e.target.value)} rows={3} placeholder="-----BEGIN CERTIFICATE-----" className={`${INPUT} mt-0.5 font-mono`} />
      </label>
      <details className="text-[11px] text-ink-3">
        <summary className="cursor-pointer hover:text-ink-1">Déconnexion unique (SLO, facultatif)</summary>
        <div className="mt-2 space-y-2">
          <p>Se déconnecter de Datick déconnecte aussi du fournisseur, et une déconnexion demandée par le fournisseur (signée) ferme les sessions Datick de la personne. Si le fournisseur exige des demandes signées, donne une clé et un certificat propres à Datick (ils figurent ensuite dans les métadonnées).</p>
          {field('logoutUrl', 'Adresse de déconnexion du fournisseur (SLO, HTTP-Redirect)', 'https://login.example.com/saml2/logout')}
          <label className="block">{s.spKeySet ? 'Clé privée de Datick (enregistrée ; coller une nouvelle pour la remplacer)' : 'Clé privée de Datick (PEM, facultatif)'}
            <textarea value={spKey} onChange={e => setSpKey(e.target.value)} rows={2} autoComplete="off" placeholder="-----BEGIN PRIVATE KEY-----" className={`${INPUT} mt-0.5 font-mono`} />
          </label>
          <label className="block">{s.spCertSet ? 'Certificat de Datick (enregistré)' : 'Certificat de Datick (PEM, facultatif)'}
            <textarea value={spCert} onChange={e => setSpCert(e.target.value)} rows={2} placeholder="-----BEGIN CERTIFICATE-----" className={`${INPUT} mt-0.5 font-mono`} />
          </label>
        </div>
      </details>
      <div className="space-y-1 text-[11px] text-ink-3">
        <p>À déclarer chez le fournisseur :</p>
        {[['Identifiant (entity ID) et métadonnées', s.spEntityId], ['Adresse de retour (ACS, HTTP-POST)', s.acsUrl], ...(s.logoutUrl ? [['Déconnexion unique (SLO, HTTP-Redirect)', s.sloUrl]] : [])].map(([l, v]) => (
          <p key={l} className="flex flex-wrap items-center gap-2"><span>{l} :</span><code className="px-1 rounded bg-overlay/6 text-ink-2" translate="no">{v}</code><button type="button" onClick={() => copy(v)} className="underline hover:text-ink-1">Copier</button></p>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white">Enregistrer</button>
        <button type="button" onClick={diagnose} className="px-3 py-2 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1">Vérifier le réglage</button>
        {s.enabled && s.idpCertSet && <button type="button" onClick={testLogin} className="px-3 py-2 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1">Connexion d'essai</button>}
      </div>
      {s.enabled && s.idpCertSet && <p className="text-[11px] text-ink-4">La connexion d'essai ouvre le fournisseur dans un nouvel onglet et affiche ce qu'il renvoie (identifiant, adresse, groupes, compte trouvé), sans ouvrir de session.</p>}
      {diag && (
        <ul role="status" className="text-[11px] space-y-0.5">
          {diag.checks.map(c => <li key={c.label} className={c.ok ? (c.warn ? 'text-amber-400' : 'text-emerald-400') : 'text-red-400'}>{`${c.ok ? '✓' : '✗'} ${c.label} : ${c.detail}`}</li>)}
        </ul>
      )}
    </section>
  );
}
