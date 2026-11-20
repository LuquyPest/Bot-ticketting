import React, { useEffect, useState } from 'react';
import { Contact, Loader2, RefreshCw } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { uiLocale } from '../i18n';

// Paramètres → Intégrations → CRM (v7, utils/crm.js): HubSpot or Salesforce, read only — the
// requester's card on the ticket view, and the companies and contacts synchronised.
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';

export default function CrmSettings() {
  const [s, setS] = useState(null);
  const [form, setForm] = useState({ provider: '', token: '', portalId: '', instanceUrl: '', clientId: '', clientSecret: '', dailySync: false });
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/crm/settings').then(r => { setS(r.data); setForm(f => ({ ...f, provider: r.data.provider || '', portalId: r.data.portalId || '', instanceUrl: r.data.instanceUrl || '', clientId: r.data.clientId || '', dailySync: !!r.data.dailySync, token: '', clientSecret: '' })); }).catch(() => setS(false));
  useEffect(() => { load(); }, []);
  if (s === null) return <Loader2 className="animate-spin text-ink-4" />;
  if (!s) return null;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { const r = await api.put('/crm/settings', form.provider ? form : { provider: null }); setS(r.data); setForm(f => ({ ...f, token: '', clientSecret: '' })); toast.success('CRM enregistré'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true);
    try { const { data } = await api.post('/crm/sync'); toast.success(`Organisations : ${data.organizations.created} créée(s), ${data.organizations.updated} mise(s) à jour · contacts : ${data.contacts.created} créé(s), ${data.contacts.updated} mis à jour`); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2.5">
      <p className="text-sm font-semibold text-ink-1 inline-flex items-center gap-1.5"><Contact size={14} aria-hidden="true" />CRM</p>
      <p className="text-xs text-ink-3">En lecture seule : la fiche du demandeur (société, propriétaire, valeur) sur chaque ticket, et la synchronisation des sociétés et des contacts vers les organisations et contacts de l'espace.</p>
      <select value={form.provider} onChange={e => set('provider', e.target.value)} aria-label="CRM" className={`${INPUT} max-w-xs`}>
        <option value="">Aucun CRM</option><option value="hubspot">HubSpot</option><option value="salesforce">Salesforce</option>
      </select>
      {form.provider === 'hubspot' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input type="password" value={form.token} onChange={e => set('token', e.target.value)} autoComplete="off" placeholder={s.hasToken && s.provider === 'hubspot' ? 'Jeton enregistré (laisser vide pour le garder)' : 'Jeton d\'application privée (pat-…)'} aria-label="Jeton HubSpot" className={INPUT} />
          <input value={form.portalId} onChange={e => set('portalId', e.target.value.replace(/\D/g, ''))} placeholder="ID du portail (liens vers les fiches, facultatif)" aria-label="ID du portail HubSpot" className={INPUT} />
        </div>
      )}
      {form.provider === 'salesforce' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={form.instanceUrl} onChange={e => set('instanceUrl', e.target.value)} placeholder="https://societe.my.salesforce.com" aria-label="Adresse de l'instance Salesforce" className={INPUT} />
          <input value={form.clientId} onChange={e => set('clientId', e.target.value)} placeholder="Client ID de l'application connectée" aria-label="Client ID Salesforce" className={INPUT} />
          <input type="password" value={form.clientSecret} onChange={e => set('clientSecret', e.target.value)} autoComplete="off" placeholder={s.hasSecret && s.provider === 'salesforce' ? 'Secret enregistré (laisser vide pour le garder)' : 'Client secret'} aria-label="Client secret Salesforce" className={INPUT} />
          <input type="password" value={form.token} onChange={e => set('token', e.target.value)} autoComplete="off" placeholder={s.hasToken && s.provider === 'salesforce' ? 'Jeton enregistré' : 'Ou un jeton d\'accès (facultatif)'} aria-label="Jeton d'accès Salesforce" className={INPUT} />
        </div>
      )}
      {form.provider && (
        <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={form.dailySync} onChange={e => set('dailySync', e.target.checked)} className="accent-primary" />Synchroniser les sociétés et contacts chaque nuit</label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Enregistrer</button>
        {s.provider && <button type="button" onClick={sync} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><RefreshCw size={12} aria-hidden="true" />Synchroniser maintenant</button>}
        {s.lastSync?.at && <span className="text-[11px] text-ink-4">{`Dernière synchronisation : ${new Date(s.lastSync.at).toLocaleString(uiLocale())}`}</span>}
      </div>
    </div>
  );
}
