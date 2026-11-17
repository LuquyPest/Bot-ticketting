import React, { useEffect, useState } from 'react';
import { Mail, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const INPUT = 'w-full bg-surface border border-overlay/8 rounded-lg px-2.5 py-1.5 text-xs text-ink-1';

// Instance → Santé: the SMTP server Datick uses to write to people (invitations, sign-in links,
// password resets) — not the support mailboxes of the spaces
export default function InstanceEmailCard() {
  const [s, setS] = useState(null);
  const [password, setPassword] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/instance/email').then(r => setS(r.data)).catch(() => {}); }, []);
  if (!s || typeof s.port !== 'number') return null;
  const set = (k, v) => setS(x => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { const r = await api.put('/instance/email', { ...s, password }); setS(r.data); setPassword(''); toast.success('E-mail de l\'instance enregistré'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    try { await api.post('/instance/email/test', { to }); toast.success(`E-mail de test envoyé à ${to}`); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const field = (label, key, props = {}) => (
    <label className="block text-xs text-ink-3">{label}
      <input value={s[key] ?? ''} onChange={e => set(key, e.target.value)} className={`${INPUT} mt-1`} {...props} />
    </label>
  );
  return (
    <div className="glass-dark rounded-2xl border border-overlay/8 px-5 py-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-ink-1 inline-flex items-center gap-2"><Mail size={14} aria-hidden="true" />E-mail de l'instance {s.enabled ? <span className="text-emerald-400 text-xs">· activé</span> : <span className="text-ink-4 text-xs">· désactivé</span>}</p>
        <p className="text-xs text-ink-3 mt-0.5">Le serveur d'envoi que Datick utilise pour écrire aux personnes : invitations, liens de connexion, réinitialisations de mot de passe. Les boîtes de support de chaque espace se règlent à part.</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-1">
        <input type="checkbox" checked={!!s.enabled} onChange={e => set('enabled', e.target.checked)} className="accent-primary" />
        Envoyer des e-mails
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {field('Serveur SMTP', 'host', { placeholder: 'smtp.example.com' })}
        <label className="block text-xs text-ink-3">Port
          <select value={s.port} onChange={e => set('port', Number(e.target.value))} className={`${INPUT} mt-1`}>
            <option value={587}>587 (STARTTLS)</option><option value={465}>465 (TLS)</option><option value={25}>25</option><option value={2525}>2525</option>
          </select>
        </label>
        {field('Identifiant (facultatif)', 'user', { autoComplete: 'off' })}
        <label className="block text-xs text-ink-3">Mot de passe
          <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder={s.passwordSet ? '•••••••• (inchangé)' : ''} className={`${INPUT} mt-1`} />
        </label>
        {field('Adresse d\'expéditeur', 'from', { type: 'email', placeholder: 'datick@example.com' })}
        {field('Nom affiché (facultatif)', 'fromName', { placeholder: 'Datick' })}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Enregistrer</button>
        <label className="text-xs text-ink-3">Envoyer un test à
          <input type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="toi@example.com" className={`${INPUT} mt-1 w-56`} />
        </label>
        <button onClick={test} disabled={busy || !s.enabled || !to} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Envoyer le test
        </button>
      </div>
    </div>
  );
}
