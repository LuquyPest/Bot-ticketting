import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Loader2, CheckCircle2 } from 'lucide-react';
import api from '../api';

const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2.5 text-sm focus:outline-hidden focus:border-primary/50';

// /reset-password: ask for the link (no token) or choose a new password (?token= from the e-mail)
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const request = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try { const { data } = await api.post('/auth/password-reset', { email }); setMessage(data.message); }
    catch (err) { setError(err.response?.data?.error || 'Erreur, réessaie.'); }
    setBusy(false);
  };
  const choose = async e => {
    e.preventDefault();
    if (password !== confirm) { setError('Les deux mots de passe ne sont pas identiques'); return; }
    setBusy(true); setError('');
    try { await api.post('/auth/password-reset/confirm', { token, password }); setDone(true); }
    catch (err) { setError(err.response?.data?.error || 'Erreur, réessaie.'); }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface-card border border-overlay/8 rounded-2xl p-6 space-y-4">
        <h1 className="text-lg font-bold text-ink-1 inline-flex items-center gap-2"><KeyRound size={18} aria-hidden="true" />Mot de passe oublié</h1>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        {done ? (
          <div className="space-y-3" role="status">
            <p className="text-sm text-emerald-400 inline-flex items-center gap-2"><CheckCircle2 size={16} aria-hidden="true" />Mot de passe changé. Tes autres sessions ont été fermées.</p>
            <a href="/login" className="inline-block px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold">Se connecter</a>
          </div>
        ) : token ? (
          <form onSubmit={choose} className="space-y-3">
            <p className="text-sm text-ink-3">Choisis un nouveau mot de passe (10 caractères au moins).</p>
            <input type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Nouveau mot de passe" aria-label="Nouveau mot de passe" className={INPUT} />
            <input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Encore une fois" aria-label="Confirmer le mot de passe" className={INPUT} />
            <button type="submit" disabled={busy || !password} className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />} Enregistrer le mot de passe
            </button>
          </form>
        ) : message ? (
          <p className="text-sm text-ink-2" role="status">{message}</p>
        ) : (
          <form onSubmit={request} className="space-y-3">
            <p className="text-sm text-ink-3">Indique l'adresse e-mail de ton compte : tu recevras un lien pour choisir un nouveau mot de passe.</p>
            <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Adresse e-mail" aria-label="Adresse e-mail" className={INPUT} />
            <button type="submit" disabled={busy || !email} className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />} Envoyer le lien
            </button>
          </form>
        )}
        <p className="text-center"><a href="/login" className="text-xs text-ink-3 hover:text-ink-1 underline">Retour à la connexion</a></p>
      </div>
    </div>
  );
}
