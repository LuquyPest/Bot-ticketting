import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserPlus, Loader2, CheckCircle2 } from 'lucide-react';
import api from '../api';

const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2.5 text-sm focus:outline-hidden focus:border-primary/50';
const ROLE = { support: 'Support', fondateur: 'Fondateur' };
// Kept while the person signs in, to come back here afterwards (pages/GuildSelect.jsx)
export const PENDING_KEY = 'datick.pendingInvitation';

// /invitation?token=… : link of an invitation to the team of a space (utils/invitations.js)
export default function Invitation() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    try { sessionStorage.removeItem(PENDING_KEY); } catch { /* storage off */ }
    api.get('/auth/invitation', { params: { token } })
      .then(r => setInfo(r.data))
      .catch(err => setError(err.response?.data?.error || 'Invitation introuvable'));
  }, [token]);

  const accept = async e => {
    e.preventDefault();
    if (!info.signedIn && password !== confirm) { setError('Les deux mots de passe ne sont pas identiques'); return; }
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/auth/invitation/accept', info.signedIn ? { token } : { token, displayName: name, password });
      setDone(data);
    } catch (err) { setError(err.response?.data?.error || 'Erreur, réessaie.'); }
    setBusy(false);
  };
  const signIn = () => {
    try { sessionStorage.setItem(PENDING_KEY, token); } catch { /* storage off */ }
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <main className="w-full max-w-sm bg-surface-card border border-overlay/8 rounded-2xl p-6 space-y-4">
        <h1 className="text-lg font-bold text-ink-1 inline-flex items-center gap-2"><UserPlus size={18} aria-hidden="true" />Invitation</h1>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        {done ? (
          <div className="space-y-3" role="status">
            <p className="text-sm text-emerald-400 inline-flex items-center gap-2"><CheckCircle2 size={16} aria-hidden="true" />{`Tu fais maintenant partie de l'équipe de ${info.space}.`}</p>
            <a href={done.redirect || '/select-guild'} className="inline-block px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold">Ouvrir le dashboard</a>
          </div>
        ) : info ? (
          <form onSubmit={accept} className="space-y-3">
            <p className="text-sm text-ink-2">{`${info.invitedBy} t'invite à rejoindre l'équipe de ${info.space}, rôle ${ROLE[info.role]}.`}</p>
            {info.signedIn ? (
              <p className="text-sm text-ink-3">{`Connecté en tant que ${info.signedIn.username} : ce compte rejoindra l'équipe.`}</p>
            ) : info.needsLogin ? (
              <p className="text-sm text-ink-3">{`Un compte utilise déjà l'adresse ${info.email} : connecte-toi, tu reviendras ici ensuite.`}</p>
            ) : (
              <>
                <p className="text-sm text-ink-3">{`Crée ton compte pour ${info.email}.`}</p>
                <input required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Ton nom" aria-label="Ton nom" autoComplete="name" className={INPUT} />
                <input type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Mot de passe (10 caractères au moins)" aria-label="Mot de passe" className={INPUT} />
                <input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Encore une fois" aria-label="Confirmer le mot de passe" className={INPUT} />
              </>
            )}
            {info.needsLogin ? (
              <button type="button" onClick={signIn} className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold">Se connecter</button>
            ) : (
              <button type="submit" disabled={busy || (!info.signedIn && (!name || !password))} className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" />} Rejoindre l'équipe
              </button>
            )}
          </form>
        ) : !error && <p className="text-sm text-ink-3 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Chargement…</p>}
      </main>
    </div>
  );
}
