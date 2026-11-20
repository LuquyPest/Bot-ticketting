import React, { useEffect, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

// Paramètres → E-mail → Modèle des e-mails (v7, utils/emailTemplate.js), with a live preview
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';

export default function EmailTemplateEditor() {
  const [t, setT] = useState(null);
  const [html, setHtml] = useState('');
  useEffect(() => { api.get('/email-template').then(r => setT(r.data)).catch(() => setT(false)); }, []);
  useEffect(() => {
    if (!t) return undefined;
    const timer = setTimeout(() => api.post('/email-template/preview', t).then(r => setHtml(r.data.html || '')).catch(() => {}), 400);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  const set = (k, v) => setT(x => ({ ...x, [k]: v }));
  const save = async () => { try { setT((await api.put('/email-template', t)).data); toast.success('Modèle enregistré'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-3">Modèle des e-mails envoyés aux demandeurs (réponses et messages automatiques). Laisse un champ vide pour garder celui de l'espace membre.</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
        <input value={t.logo} onChange={e => set('logo', e.target.value)} placeholder="Logo : https://exemple.fr/logo.png" aria-label="Logo des e-mails (adresse https)" className={INPUT} />
        <div className="flex gap-1.5 items-center">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#5865f2'} onChange={e => set('color', e.target.value)} aria-label="Couleur des e-mails" className="h-8 w-10 rounded border border-overlay/8 bg-surface" />
          {t.color && <button type="button" onClick={() => set('color', '')} className="text-[11px] text-ink-3 hover:text-ink-1 underline">par défaut</button>}
        </div>
      </div>
      <label className="block text-[11px] text-ink-3">En-tête, au-dessus du message (markdown)
        <textarea value={t.header} onChange={e => set('header', e.target.value)} rows={2} maxLength={1000} placeholder="Notre support répond du lundi au vendredi, de 9 h à 18 h." className={`${INPUT} mt-1`} />
      </label>
      <label className="block text-[11px] text-ink-3">Pied de page (markdown ; vide : le texte standard)
        <textarea value={t.footer} onChange={e => set('footer', e.target.value)} rows={2} maxLength={1000} placeholder="Acme SAS · [Mentions légales](https://exemple.fr/mentions)" className={`${INPUT} mt-1`} />
      </label>
      <button type="button" onClick={save} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white">Enregistrer le modèle</button>
      {html && <iframe title="Aperçu de l'e-mail" sandbox="" srcDoc={html} className="w-full h-80 rounded-lg border border-overlay/8 bg-white" />}
    </div>
  );
}
