import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Rocket, Loader2 } from 'lucide-react';
import api from '../api';

const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2.5 text-sm focus:outline-hidden focus:border-primary/50';

// /installation: the first owner of an instance installed without Discord, with the install token
// (from .env, or printed in the logs at start-up). Refused once the instance has an owner.
export default function Installation() {
  const [params] = useSearchParams();
  const [needed, setNeeded] = useState(null);
  const [form, setForm] = useState({ token: params.get('token') || '', email: '', displayName: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/installation').then(r => setNeeded(r.data.needed)).catch(() => setNeeded(false)); }, []);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async e => {
    e.preventDefault();
    if (form.password !== form.confirm) { setError('Les deux mots de passe ne sont pas identiques'); return; }
    setBusy(true); setError('');
    try { const { data } = await api.post('/installation/owner', form); window.location.href = data.redirect || '/instance'; }
    catch (err) { setError(err.response?.data?.error || 'Erreur, réessaie.'); setBusy(false); }
  };
  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface-card border border-overlay/8 rounded-2xl p-6 space-y-4">
        <h1 className="text-lg font-bold text-ink-1 inline-flex items-center gap-2"><Rocket size={18} aria-hidden="true" />Première installation</h1>
        {needed === null ? <Loader2 size={16} className="animate-spin text-ink-4" /> : !needed ? (
          <p className="text-sm text-ink-2">Cette instance a déjà un propriétaire. <a href="/login" className="text-primary-light underline">Se connecter</a></p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm text-ink-3">Crée le compte du propriétaire de l'instance. Le jeton d'installation est dans ton <code>.env</code> (<code>INSTALL_TOKEN</code>) ou dans les logs du démarrage.</p>
            {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
            <input value={form.token} onChange={e => set('token', e.target.value.trim())} required placeholder="Jeton d'installation" aria-label="Jeton d'installation" autoComplete="off" className={INPUT} />
            <input value={form.displayName} onChange={e => set('displayName', e.target.value)} required maxLength={100} placeholder="Ton nom" aria-label="Ton nom" className={INPUT} />
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} required autoComplete="username" placeholder="Adresse e-mail" aria-label="Adresse e-mail" className={INPUT} />
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} required autoComplete="new-password" placeholder="Mot de passe (10 caractères au moins)" aria-label="Mot de passe" className={INPUT} />
            <input type="password" value={form.confirm} onChange={e => set('confirm', e.target.value)} required autoComplete="new-password" placeholder="Encore une fois" aria-label="Confirmer le mot de passe" className={INPUT} />
            <button type="submit" disabled={busy} className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />} Créer le compte du propriétaire
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
