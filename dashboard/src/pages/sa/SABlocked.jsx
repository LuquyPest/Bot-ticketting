import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2, Lock, Globe, Unlock } from 'lucide-react';
import api from '../../api';
import toast from 'react-hot-toast';

// Remaining time until a block expires, e.g. "12 min" / "45 s".
function remaining(date) {
  const ms = new Date(date).getTime() - Date.now();
  if (ms <= 0) return 'expiré';
  return ms >= 60000 ? `${Math.ceil(ms / 60000)} min` : `${Math.ceil(ms / 1000)} s`;
}

const fmt = d => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Section({ icon: Icon, title, hint, count, children }) {
  return (
    <div className="glass-dark rounded-2xl border border-white/8 overflow-hidden">
      <div className="px-5 py-4 border-b border-white/6 flex items-center gap-2.5">
        <Icon size={15} className="text-red-400" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-ink-1">{title} <span className="text-ink-4 font-normal">({count})</span></h2>
          <p className="text-[11px] text-ink-4">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function UnblockBtn({ onClick, busy }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-400
                 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-50">
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />} Débloquer
    </button>
  );
}

export default function SABlocked() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.get('/sa/blocked')
      .then(r => setData(r.data))
      .catch(err => { toast.error(err.response?.data?.error || 'Erreur chargement'); setData({ accounts: [], ips: [] }); });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const unlockAccount = async (a) => {
    setBusy(`acc:${a.type}:${a.id}`);
    try {
      await api.post(`/sa/blocked/accounts/${a.type}/${a.id}/unlock`);
      toast.success(`Compte ${a.username} débloqué`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(null);
  };

  const unblockIp = async (b) => {
    setBusy(`ip:${b.limiter}:${b.key}`);
    try {
      await api.post('/sa/blocked/ips/unblock', { limiter: b.limiter, key: b.key });
      toast.success(`${b.ip} débloquée`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(null);
  };

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-ink-1">Blocages</h1>
          <p className="text-sm text-ink-3">Comptes et adresses bloqués après trop de tentatives — actualisé toutes les 30 s</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-white/5" title="Actualiser">
          <RefreshCw size={15} />
        </button>
      </div>

      {data === null ? (
        <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-ink-3" /></div>
      ) : (
        <>
          <Section icon={Lock} title="Comptes super-admin / manager verrouillés" count={data.accounts.length}
            hint="Verrouillés 15 min après 5 échecs de mot de passe ou de code 2FA">
            {data.accounts.length === 0 ? (
              <p className="px-5 py-6 text-xs text-ink-4 text-center">Aucun compte verrouillé</p>
            ) : (
              <ul className="divide-y divide-white/4">
                {data.accounts.map(a => (
                  <li key={`${a.type}:${a.id}`} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink-1">{a.username} <span className="text-[10px] text-ink-4 uppercase">{a.type === 'superadmin' ? 'Super-admin' : 'Manager'}</span></p>
                      <p className="text-[11px] text-ink-4">{a.failed_attempts} échec(s) — déblocage auto dans {remaining(a.locked_until)}</p>
                    </div>
                    <UnblockBtn onClick={() => unlockAccount(a)} busy={busy === `acc:${a.type}:${a.id}`} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={Globe} title="Adresses IP limitées" count={data.ips.length}
            hint="Trop de tentatives de connexion (dashboard ou panel) ou de requêtes API depuis une même adresse">
            {data.ips.length === 0 ? (
              <p className="px-5 py-6 text-xs text-ink-4 text-center">Aucune adresse bloquée</p>
            ) : (
              <ul className="divide-y divide-white/4">
                {data.ips.map(b => (
                  <li key={`${b.limiter}:${b.key}`} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink-1 font-mono">{b.ip}</p>
                      <p className="text-[11px] text-ink-4">
                        {b.limiterLabel} · dernière requête refusée sur {b.path} · depuis {fmt(b.since)} · {b.hits} refus — déblocage auto dans {remaining(b.resetAt)}
                      </p>
                    </div>
                    <UnblockBtn onClick={() => unblockIp(b)} busy={busy === `ip:${b.limiter}:${b.key}`} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
