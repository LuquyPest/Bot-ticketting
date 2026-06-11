import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, ShieldOff, Loader2, Eye, EyeOff, Check } from 'lucide-react';
import { useAuth } from '../App';
import api from '../api';
import toast from 'react-hot-toast';

const ROLE_STYLES = {
  fondateur: { text: 'text-violet-300', bg: 'bg-violet-500/10 border-violet-500/20', label: 'Fondateur' },
  support:   { text: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Support' },
  nouveau:   { text: 'text-amber-300',   bg: 'bg-amber-500/10 border-amber-500/20',     label: 'Nouveau' },
};

function TotpInput({ value, onChange, autoFocus, label = 'Code 2FA' }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-ink-3">{label}</label>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="000 000"
        maxLength={7}
        autoFocus={autoFocus}
        className="w-full px-3 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08]
                   text-base text-ink-1 placeholder-ink-4 outline-none focus:border-primary/50
                   text-center tracking-[0.4em] font-mono transition-colors"
      />
    </div>
  );
}

export default function ProfileModal({ onClose }) {
  const { user } = useAuth();
  const roleStyle = ROLE_STYLES[user?.role] || ROLE_STYLES.nouveau;

  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);

  // setup flow
  const [step, setStep] = useState('idle'); // idle | setup-qr | setup-confirm | disable-confirm
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secret, setSecret]       = useState('');
  const [code, setCode]           = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError]         = useState('');

  const avatarUrl = user?.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128`
    : null;

  useEffect(() => {
    api.get('/profile/2fa')
      .then(r => setTwoFaEnabled(r.data.enabled))
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, []);

  const resetState = () => {
    setStep('idle');
    setCode('');
    setError('');
    setQrDataUrl('');
    setSecret('');
    setShowSecret(false);
  };

  // ── Activate flow ────────────────────────────────────────────────────────

  const startSetup = async () => {
    setActionLoading(true);
    setError('');
    try {
      const r = await api.post('/profile/2fa/setup');
      setQrDataUrl(r.data.qrDataUrl);
      setSecret(r.data.secret);
      setCode('');
      setStep('setup-qr');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur');
    }
    setActionLoading(false);
  };

  const confirmEnable = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    setError('');
    try {
      await api.post('/profile/2fa/enable', { code });
      setTwoFaEnabled(true);
      resetState();
      toast.success('2FA activé — ton compte est maintenant protégé');
    } catch (err) {
      setError(err.response?.data?.error || 'Code invalide');
    }
    setActionLoading(false);
  };

  // ── Disable flow ─────────────────────────────────────────────────────────

  const confirmDisable = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    setError('');
    try {
      await api.post('/profile/2fa/disable', { code });
      setTwoFaEnabled(false);
      resetState();
      toast.success('2FA désactivé');
    } catch (err) {
      setError(err.response?.data?.error || 'Code invalide');
    }
    setActionLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="glass-dark rounded-2xl border border-white/[0.08] p-6 w-full max-w-sm
                      shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-1">Mon profil</h2>
          <button onClick={onClose}
            className="text-ink-4 hover:text-ink-1 p-1 rounded-lg hover:bg-white/[0.05] transition-all">
            <X size={16} />
          </button>
        </div>

        {/* User info */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-12 h-12 rounded-full ring-2 ring-white/10 flex-shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600
                            flex items-center justify-center text-lg font-bold text-white flex-shrink-0">
              {user?.username?.[0]?.toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-1 truncate">{user?.username}</p>
            <p className="text-[10px] font-mono text-ink-4 truncate">ID {user?.id}</p>
            {user?.role && (
              <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wide
                               px-1.5 py-0.5 rounded-md mt-1 border ${roleStyle.bg} ${roleStyle.text}`}>
                {roleStyle.label}
              </span>
            )}
          </div>
        </div>

        {/* 2FA section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-ink-2">Double authentification (2FA)</p>
            {statusLoading ? (
              <Loader2 size={14} className="animate-spin text-ink-4" />
            ) : (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border
                               ${twoFaEnabled
                                 ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                                 : 'text-ink-4 bg-white/[0.04] border-white/[0.08]'}`}>
                {twoFaEnabled ? '● Activé' : '○ Désactivé'}
              </span>
            )}
          </div>

          {/* idle state */}
          {step === 'idle' && !statusLoading && (
            <>
              {twoFaEnabled ? (
                <div className="space-y-3">
                  <p className="text-xs text-ink-4">
                    Le 2FA protège ton compte même si quelqu'un obtient ton accès Discord OAuth.
                  </p>
                  <button onClick={() => { setStep('disable-confirm'); setCode(''); setError(''); }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                               text-sm font-medium text-red-400 border border-red-500/20
                               hover:bg-red-500/10 transition-all">
                    <ShieldOff size={14} />
                    Désactiver le 2FA
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-ink-4">
                    Protège ton compte avec une application d'authentification (Google Authenticator, Authy…).
                  </p>
                  <button onClick={startSetup} disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                               text-sm font-semibold text-white bg-primary hover:bg-primary-light
                               disabled:opacity-60 transition-all">
                    {actionLoading
                      ? <Loader2 size={14} className="animate-spin" />
                      : <ShieldCheck size={14} />
                    }
                    Activer le 2FA
                  </button>
                </div>
              )}
            </>
          )}

          {/* setup — show QR + confirm */}
          {step === 'setup-qr' && (
            <form onSubmit={confirmEnable} className="space-y-4">
              <p className="text-xs text-ink-3 text-center">
                Scanne ce QR code avec ton application, puis entre le code pour confirmer.
              </p>
              {qrDataUrl && (
                <div className="flex justify-center">
                  <img src={qrDataUrl} alt="QR 2FA"
                    className="w-40 h-40 rounded-xl border border-white/[0.1] p-2 bg-white" />
                </div>
              )}
              {secret && (
                <div className="text-center">
                  <button type="button" onClick={() => setShowSecret(s => !s)}
                    className="text-[10px] text-ink-4 hover:text-ink-2 transition-colors flex items-center gap-1 mx-auto">
                    {showSecret ? <EyeOff size={10} /> : <Eye size={10} />}
                    {showSecret ? 'Masquer' : 'Afficher'} la clé manuelle
                  </button>
                  {showSecret && (
                    <p className="text-[10px] font-mono text-ink-3 mt-1 break-all select-all px-2">
                      {secret}
                    </p>
                  )}
                </div>
              )}
              <TotpInput value={code} onChange={setCode} autoFocus />
              {error && <p className="text-xs text-red-400 text-center">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={resetState}
                  className="flex-1 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1
                             hover:bg-white/[0.05] transition-all">
                  Annuler
                </button>
                <button type="submit"
                  disabled={actionLoading || code.replace(/\s/g, '').length < 6}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold text-white bg-primary
                             hover:bg-primary-light disabled:opacity-60 transition-all
                             flex items-center justify-center gap-2">
                  {actionLoading
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Check size={13} />
                  }
                  Confirmer
                </button>
              </div>
            </form>
          )}

          {/* disable — ask confirmation code */}
          {step === 'disable-confirm' && (
            <form onSubmit={confirmDisable} className="space-y-4">
              <p className="text-xs text-ink-3 text-center">
                Entre le code de ton application pour confirmer la désactivation.
              </p>
              <TotpInput value={code} onChange={setCode} autoFocus />
              {error && <p className="text-xs text-red-400 text-center">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={resetState}
                  className="flex-1 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1
                             hover:bg-white/[0.05] transition-all">
                  Annuler
                </button>
                <button type="submit"
                  disabled={actionLoading || code.replace(/\s/g, '').length < 6}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold text-white bg-red-600
                             hover:bg-red-500 disabled:opacity-60 transition-all
                             flex items-center justify-center gap-2">
                  {actionLoading
                    ? <Loader2 size={13} className="animate-spin" />
                    : <ShieldOff size={13} />
                  }
                  Désactiver
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
