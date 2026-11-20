import React, { useEffect, useState } from 'react';
import api from '../api';
import { uiLocale } from '../i18n';

// Profil → Mes appareils mobiles (v7): the devices of the app that get the notifications
export default function MobileDevices() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/profile/mobile-devices').then(r => setD(r.data)).catch(() => setD(null)); }, []);
  if (!d?.configured) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-ink-3">Application mobile : ouvre-la et choisis cette instance pour recevoir les notifications sur ton téléphone.</p>
      {d.devices.length === 0 ? <p className="text-xs text-ink-4">Aucun appareil.</p> : (
        <ul className="space-y-1">
          {d.devices.map(x => (
            <li key={x.id} className="text-xs text-ink-2 flex items-center gap-2">{`${x.platform === 'ios' ? 'iPhone / iPad' : 'Android'} · vu le ${new Date(x.lastSeenAt).toLocaleDateString(uiLocale())}`}
              <button type="button" onClick={() => api.delete(`/profile/mobile-devices/${x.id}`).then(r => setD(v => ({ ...v, devices: r.data.devices })))} className="underline text-ink-3 hover:text-red-400">Retirer</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
