import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, Mail } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';

const fmt = d => (d ? new Date(d).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary/50';
const BTN = 'px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50';

// Profil → Connexion: the ways this account signs in — Discord, and an e-mail address (confirmed
// by a link) with a password. Google, Microsoft and other providers come with the next steps.
export default function LoginMethods() {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/profile/login-methods').then(r => setData(Array.isArray(r.data?.identities) ? r.data : false)).catch(() => setData(false));
  useEffect(() => {
    load();
    // Back from the confirmation link
    const state = new URLSearchParams(window.location.search).get('email');
    if (state === 'verified') toast.success('Adresse e-mail confirmée');
    else if (state === 'expired') toast.error('Lien de confirmation expiré ou déjà utilisé');
    else if (state === 'taken') toast.error('Adresse déjà utilisée par un autre compte');
  }, []);
  if (data === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (data === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const act = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); setCurrent(''); setPassword(''); await load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const verified = data.account?.email && data.account.emailVerified;
  return (
    <div className="space-y-4">
      <ul className="space-y-1.5">
        {data.identities.map(i => (
          <li key={`${i.provider}:${i.subject}`} className="flex flex-wrap items-center gap-2 bg-overlay/3 rounded-lg px-3 py-2 text-sm">
            <KeyRound size={14} className="text-primary-light" aria-hidden="true" />
            <span className="font-medium text-ink-1">{i.label}</span>
            <span className="text-xs text-ink-4" translate="no">{i.subject}</span>
            <span className="ml-auto text-xs text-ink-3">Dernière utilisation : {fmt(i.lastUsedAt)}</span>
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-ink-2 inline-flex items-center gap-1.5"><Mail size={13} aria-hidden="true" />Adresse e-mail</p>
        {verified && <p className="text-sm text-ink-1" translate="no">{data.account.email} <span className="text-xs text-emerald-400">· confirmée</span></p>}
        <div className="flex flex-wrap gap-2">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={verified ? 'Nouvelle adresse' : 'toi@example.com'} aria-label="Adresse e-mail" className={`${INPUT} max-w-xs`} />
          <button onClick={() => act(() => api.post('/profile/email', { email }), 'Lien de confirmation envoyé : ouvre-le depuis ta boîte mail')} disabled={busy || !email} className={`${BTN} bg-primary text-white`}>Envoyer le lien de confirmation</button>
        </div>
        {verified && <p className="text-xs text-ink-4">Changer d'adresse retire le mot de passe : il faudra en choisir un nouveau.</p>}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-ink-2 inline-flex items-center gap-1.5"><KeyRound size={13} aria-hidden="true" />Mot de passe {data.password ? <span className="text-emerald-400 font-normal">· défini</span> : <span className="text-ink-4 font-normal">· aucun</span>}</p>
        {!verified ? (
          <p className="text-xs text-ink-4">Confirme d'abord une adresse e-mail : c'est elle qui sert à se connecter.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.password && <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} placeholder="Mot de passe actuel" aria-label="Mot de passe actuel" className={`${INPUT} max-w-[12rem]`} />}
            <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Nouveau (10 caractères au moins)" aria-label="Nouveau mot de passe" className={`${INPUT} max-w-[15rem]`} />
            <button onClick={() => act(() => api.post('/profile/password', { current, password }), data.password ? 'Mot de passe changé, tes autres sessions sont fermées' : 'Mot de passe défini : tu peux te connecter avec ton adresse e-mail')} disabled={busy || !password} className={`${BTN} bg-primary text-white`}>{data.password ? 'Changer' : 'Définir'}</button>
            {data.password && data.identities.length > 0 && (
              <button onClick={() => act(() => api.delete('/profile/password', { data: { current } }), 'Mot de passe retiré')} disabled={busy || !current} className={`${BTN} border border-overlay/8 text-ink-3 hover:text-red-400`}>Retirer</button>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-ink-4">Compte créé le {fmt(data.account?.createdAt)}. La connexion par Google ou Microsoft arrive bientôt.</p>
    </div>
  );
}
