import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import api from '../api';
import { uiLocale } from '../i18n';

const fmt = d => (d ? new Date(d).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Profil → Connexion: the ways this account signs in (Discord today; e-mail and password, Google,
// Microsoft and other providers arrive with the next steps of the v4)
export default function LoginMethods() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/profile/login-methods').then(r => setData(Array.isArray(r.data?.identities) ? r.data : false)).catch(() => setData(false)); }, []);
  if (data === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (data === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {data.identities.map(i => (
          <li key={`${i.provider}:${i.subject}`} className="flex flex-wrap items-center gap-2 bg-overlay/3 rounded-lg px-3 py-2 text-sm">
            <KeyRound size={14} className="text-primary-light" aria-hidden="true" />
            <span className="font-medium text-ink-1">{i.label}</span>
            <span className="text-xs text-ink-4" translate="no">{i.subject}</span>
            <span className="ml-auto text-xs text-ink-3">Dernière utilisation : {fmt(i.lastUsedAt)}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 bg-overlay/3 rounded-lg px-3 py-2 text-sm text-ink-3">
          <KeyRound size={14} className="text-ink-4" aria-hidden="true" />
          Mot de passe : {data.password ? 'défini' : 'aucun'}
        </li>
      </ul>
      <p className="text-xs text-ink-4">Compte créé le {fmt(data.account?.createdAt)}. La connexion par e-mail et mot de passe, et par Google ou Microsoft, arrive bientôt.</p>
    </div>
  );
}
