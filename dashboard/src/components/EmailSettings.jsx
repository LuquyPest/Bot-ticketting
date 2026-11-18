import React, { useEffect, useState } from 'react';
import { Loader2, Mail, CheckCircle2, XCircle } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';
import EmailAddresses from './EmailAddresses';

const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-primary';

// Tickets by e-mail (Paramètres → Intégrations): the support mailbox of the server. Saved on its
// own (it has passwords): « Enregistrer » here, not the save bar of the page.
export default function EmailSettings() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);
  const [pw, setPw] = useState({ imapPassword: '', smtpPassword: '' });
  useEffect(() => { api.get('/email').then(r => setS(r.data)).catch(() => setS(false)); }, []);
  if (s === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (s === false) return <p className="text-xs text-ink-4">Indisponible.</p>;
  const set = (k, v) => setS(x => ({ ...x, [k]: v }));
  const att = s.attachments || {};
  const setAtt = (k, v) => setS(x => ({ ...x, attachments: { ...x.attachments, [k]: v } }));
  const purge = async all => {
    if (!window.confirm(all ? 'Supprimer les pièces jointes de tous les tickets fermés ?' : `Supprimer maintenant les pièces jointes des tickets fermés depuis plus de ${att.retentionDays} jours ?`)) return;
    setBusy(true);
    try {
      const r = await api.post('/email/attachments/purge', { all });
      setAtt('usage', r.data.usage);
      toast.success(`${r.data.files} fichier(s) supprimé(s)`);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const mb = b => `${(Number(b || 0) / 1048576).toFixed(1).replace('.', ',')} Mo`;
  const save = async () => {
    setBusy(true);
    try {
      const { usage, ...attachments } = att;
      const r = await api.put('/email', { ...s, ...pw, attachments: { ...attachments, blocked: String(attachments.blocked ?? '') } });
      setS(r.data); setPw({ imapPassword: '', smtpPassword: '' });
      toast.success(r.data.enabled ? 'Tickets par e-mail activés' : 'Réglages enregistrés');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const runTest = async () => {
    setBusy(true); setTest(null);
    try { setTest((await api.post('/email/test')).data); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  const field = (label, key, props = {}) => (
    <label className="block text-xs text-ink-3">{label}
      <input value={s[key] ?? ''} onChange={e => set(key, props.type === 'number' ? Number(e.target.value) : e.target.value)} className={`${INPUT} mt-1`} {...props} />
    </label>
  );
  const password = (label, key, isSet) => (
    <label className="block text-xs text-ink-3">{label}
      <input type="password" autoComplete="new-password" value={pw[key]} onChange={e => setPw(p => ({ ...p, [key]: e.target.value }))}
        placeholder={isSet ? '•••••••• (inchangé)' : ''} className={`${INPUT} mt-1`} />
    </label>
  );
  const Result = ({ label, r }) => r && (
    <span className={`inline-flex items-center gap-1.5 text-xs ${r.ok ? 'text-emerald-400' : 'text-red-400'}`}>
      {r.ok ? <CheckCircle2 size={13} aria-hidden="true" /> : <XCircle size={13} aria-hidden="true" />}{label} : {r.ok ? 'connexion réussie' : r.error}
    </span>
  );
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-ink-1">
        <input type="checkbox" checked={!!s.enabled} onChange={e => set('enabled', e.target.checked)} className="accent-primary" />
        Créer un ticket pour chaque e-mail reçu sur l'adresse du support
      </label>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {field('Adresse du support', 'address', { type: 'email', placeholder: 'support@example.com' })}
        {field('Nom affiché (facultatif)', 'displayName', { placeholder: 'Support Sunset' })}
      </div>
      <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <legend className="text-xs font-semibold text-ink-2 mb-1">Réception (IMAP)</legend>
        {field('Serveur', 'imapHost', { placeholder: 'imap.example.com' })}
        <label className="block text-xs text-ink-3">Port
          <select value={s.imapPort} onChange={e => set('imapPort', Number(e.target.value))} className={`${INPUT} mt-1`}>
            <option value={993}>993 (TLS)</option><option value={143}>143</option>
          </select>
        </label>
        {field('Identifiant', 'imapUser', { autoComplete: 'off' })}
        {password('Mot de passe', 'imapPassword', s.imapPasswordSet)}
      </fieldset>
      <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <legend className="text-xs font-semibold text-ink-2 mb-1">Envoi (SMTP)</legend>
        {field('Serveur', 'smtpHost', { placeholder: 'smtp.example.com' })}
        <label className="block text-xs text-ink-3">Port
          <select value={s.smtpPort} onChange={e => set('smtpPort', Number(e.target.value))} className={`${INPUT} mt-1`}>
            <option value={587}>587 (STARTTLS)</option><option value={465}>465 (TLS)</option><option value={25}>25</option><option value={2525}>2525</option>
          </select>
        </label>
        {field('Identifiant', 'smtpUser', { autoComplete: 'off' })}
        {password('Mot de passe', 'smtpPassword', s.smtpPasswordSet)}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold text-ink-2 mb-1">Pièces jointes reçues</legend>
        <label className="flex items-center gap-2 text-sm text-ink-1">
          <input type="checkbox" checked={!!att.enabled} onChange={e => setAtt('enabled', e.target.checked)} className="accent-primary" />
          Conserver les pièces jointes sur le serveur (sinon, seul leur nom est noté dans le ticket)
        </label>
        {att.enabled && (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block text-xs text-ink-3">Taille maximale par fichier (Mo)
                <input type="number" min={1} max={25} value={att.maxMb ?? 10} onChange={e => setAtt('maxMb', Number(e.target.value))} className={`${INPUT} mt-1`} />
              </label>
              <label className="block text-xs text-ink-3">Espace total (Mo)
                <input type="number" min={10} max={50000} value={att.quotaMb ?? 500} onChange={e => setAtt('quotaMb', Number(e.target.value))} className={`${INPUT} mt-1`} />
              </label>
              <label className="block text-xs text-ink-3">Garder après la fermeture du ticket (jours, 0 = toujours)
                <input type="number" min={0} max={3650} value={att.retentionDays ?? 90} onChange={e => setAtt('retentionDays', Number(e.target.value))} className={`${INPUT} mt-1`} />
              </label>
            </div>
            <label className="block text-xs text-ink-3">Types refusés (extensions, séparées par des virgules)
              <input value={Array.isArray(att.blocked) ? att.blocked.join(', ') : att.blocked || ''} onChange={e => setAtt('blocked', e.target.value)} className={`${INPUT} mt-1`} />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-1">
              <input type="checkbox" checked={!!att.postDiscord} onChange={e => setAtt('postDiscord', e.target.checked)} className="accent-primary" />
              Les publier aussi dans le salon Discord du ticket (8 Mo maximum par fichier)
            </label>
          </>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
          <span role="status">Utilisé : {att.usage?.files ?? 0} fichier(s), {mb(att.usage?.bytes)}{att.enabled ? ` sur ${att.quotaMb} Mo` : ''}</span>
          {att.retentionDays > 0 && <button onClick={() => purge(false)} disabled={busy} className="px-2.5 py-1 rounded-md border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Appliquer la conservation maintenant</button>}
          <button onClick={() => purge(true)} disabled={busy} className="px-2.5 py-1 rounded-md border border-overlay/8 text-ink-3 hover:text-red-400 disabled:opacity-50">Supprimer celles des tickets fermés</button>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">Enregistrer</button>
        <button onClick={runTest} disabled={busy || !s.imapPasswordSet} className="px-3 py-2 rounded-lg border border-overlay/8 text-sm text-ink-2 hover:text-ink-1 disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Tester la connexion
        </button>
        <Result label="IMAP" r={test?.imap} /> <Result label="SMTP" r={test?.smtp} />
      </div>
      {s.enabled && (
        <p className="text-xs text-ink-3" role="status">
          {s.lastError ? <span className="text-red-400">{s.lastError}</span>
            : s.lastFetchAt ? `Boîte lue le ${new Date(s.lastFetchAt).toLocaleString(uiLocale())}` : 'La boîte est lue chaque minute.'}
        </p>
      )}
      <EmailAddresses />
    </div>
  );
}
