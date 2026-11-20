import React, { useEffect, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

// Profil → Mon numéro pour les SMS (v7, utils/sms.js): saved, then confirmed by a code
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-sm focus:outline-hidden focus:border-primary';

export default function PhoneSettings() {
  const [s, setS] = useState(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [waiting, setWaiting] = useState(false);
  useEffect(() => { api.get('/profile/phone').then(r => setS(r.data)).catch(() => setS(false)); }, []);
  if (!s || !s.gateway) return null;
  const start = async () => { try { await api.post('/profile/phone', { phone }); setWaiting(true); setS(x => ({ ...x, phone, verified: false })); toast.success('Code envoyé par SMS'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const confirm = async () => { try { const r = await api.post('/profile/phone/confirm', { code }); setS(x => ({ ...x, ...r.data })); setWaiting(false); setCode(''); toast.success('Numéro confirmé'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const remove = async () => { try { const r = await api.delete('/profile/phone'); setS(x => ({ ...x, ...r.data })); setPhone(''); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-3">Pour recevoir des notifications par SMS (canal « SMS » des notifications), indique ton numéro au format international et confirme-le avec le code reçu.</p>
      {s.phone && s.verified && !waiting ? (
        <p className="text-sm text-ink-1">{`${s.phone} · confirmé `}<button type="button" onClick={remove} className="ml-2 text-xs text-ink-3 hover:text-red-400 underline">Retirer</button></p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input value={phone || s.phone || ''} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="+33612345678" aria-label="Mon numéro de téléphone mobile" className={INPUT} />
          <button type="button" onClick={start} disabled={!(phone || s.phone)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Recevoir un code</button>
          {(waiting || (s.phone && !s.verified)) && <>
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" aria-label="Code reçu par SMS" className={`${INPUT} w-28`} />
            <button type="button" onClick={confirm} disabled={code.length !== 6} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Confirmer</button>
          </>}
        </div>
      )}
    </div>
  );
}
