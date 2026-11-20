import React, { useEffect, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Instance → Santé → SMS (v7, utils/sms.js): the gateway for SMS notifications (owner of the instance)
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';

export default function SmsGatewayCard() {
  const [s, setS] = useState(null);
  const [f, setF] = useState({});
  const [to, setTo] = useState('');
  const load = () => api.get('/instance/sms').then(r => { setS(r.data); setF({ provider: r.data.provider || '', dailyLimit: r.data.dailyLimit, accountSid: r.data.accountSid, from: r.data.from, appKey: r.data.appKey, serviceName: r.data.serviceName, url: r.data.url }); }).catch(() => setS(false));
  useEffect(() => { load(); }, []);
  if (!s) return null;
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const secret = (k, label, isSet) => <input type="password" autoComplete="off" value={f[k] || ''} onChange={e => set(k, e.target.value)} placeholder={isSet ? `${label} enregistré (laisser vide pour le garder)` : label} aria-label={label} className={INPUT} />;
  const save = async () => { try { const r = await api.put('/instance/sms', { ...f, dailyLimit: Number(f.dailyLimit) || 200 }); setS(r.data); setF(x => ({ ...x, authToken: '', appSecret: '', consumerKey: '', token: '' })); toast.success('Passerelle SMS enregistrée'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const test = async () => { try { await api.post('/instance/sms/test', { to }); toast.success('SMS de test envoyé'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <section className="bg-surface-card border border-overlay/6 rounded-2xl p-5 space-y-2.5">
      <h2 className="text-sm font-semibold text-ink-1 inline-flex items-center gap-2"><MessageSquareText size={15} aria-hidden="true" />SMS</h2>
      <p className="text-xs text-ink-3">Passerelle des notifications par SMS : chaque membre du staff confirme son numéro dans son profil, puis les notifications peuvent passer par SMS. Les SMS sont facturés par le fournisseur.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={f.provider || ''} onChange={e => set('provider', e.target.value)} aria-label="Passerelle SMS" className={INPUT}>
          <option value="">Aucune passerelle</option><option value="twilio">Twilio</option><option value="ovh">OVHcloud</option><option value="http">HTTP générique (JSON)</option>
        </select>
        {f.provider && <input type="number" min={1} max={10000} value={f.dailyLimit || 200} onChange={e => set('dailyLimit', e.target.value)} aria-label="SMS au plus par jour et par espace" title="SMS au plus par jour et par espace" className={INPUT} />}
        {f.provider === 'twilio' && <>
          <input value={f.accountSid || ''} onChange={e => set('accountSid', e.target.value)} placeholder="Account SID (AC…)" aria-label="Account SID Twilio" className={INPUT} />
          {secret('authToken', 'Jeton Twilio', s.authTokenSet)}
          <input value={f.from || ''} onChange={e => set('from', e.target.value)} placeholder="Numéro d'envoi (+33…)" aria-label="Numéro d'envoi Twilio" className={INPUT} />
        </>}
        {f.provider === 'ovh' && <>
          <input value={f.appKey || ''} onChange={e => set('appKey', e.target.value)} placeholder="Application key" aria-label="Clé d'application OVHcloud" className={INPUT} />
          {secret('appSecret', 'Application secret', s.appSecretSet)}
          {secret('consumerKey', 'Consumer key', s.consumerKeySet)}
          <input value={f.serviceName || ''} onChange={e => set('serviceName', e.target.value)} placeholder="Compte SMS (sms-xx00000-1)" aria-label="Compte SMS OVHcloud" className={INPUT} />
          <input value={f.from || ''} onChange={e => set('from', e.target.value)} maxLength={11} placeholder="Expéditeur (facultatif)" aria-label="Expéditeur OVHcloud" className={INPUT} />
        </>}
        {f.provider === 'http' && <>
          <input value={f.url || ''} onChange={e => set('url', e.target.value)} placeholder="https://passerelle.example/sms" aria-label="Adresse de la passerelle HTTP" className={INPUT} />
          {secret('token', 'Jeton (en-tête Authorization: Bearer)', s.tokenSet)}
        </>}
      </div>
      {f.provider === 'http' && <p className="text-[11px] text-ink-4">La passerelle reçoit un POST JSON <code>{'{ "to": "+33…", "text": "…" }'}</code> ; une réponse 2xx vaut envoi.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white">Enregistrer</button>
        {s.provider && <>
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="+33612345678" aria-label="Numéro pour le SMS de test" className={`${INPUT} w-40!`} />
          <button type="button" disabled={!to} onClick={test} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Envoyer un SMS de test</button>
        </>}
      </div>
    </section>
  );
}
