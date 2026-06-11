import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { useSA } from './SAApp';
import api from '../../api';

export default function SALogin() {
  const { saUser, setSaUser } = useSA();
  const navigate = useNavigate();

  const [step, setStep]             = useState('credentials');
  const [username, setUsername]     = useState('');
  const [password, setPassword]     = useState('');
  const [showPass, setShowPass]     = useState(false);
  const [totpCode, setTotpCode]     = useState('');
  const [qrDataUrl, setQrDataUrl]   = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    if (saUser) navigate('/sa/guilds', { replace: true });
  }, [saUser]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await api.post('/sa/auth/login', { username, password });
      if (r.data.needs_totp_setup) {
        setQrDataUrl(r.data.qrDataUrl);
        setTotpSecret(r.data.secret);
        setStep('totp-setup');
      } else if (r.data.needs_totp_verify) {
        setStep('totp-verify');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de connexion');
    }
    setLoading(false);
  };

  const handleTotpSetup = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await api.post('/sa/auth/totp-setup', { code: totpCode.replace(/\s/g, '') });
      setSaUser(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Code invalide');
    }
    setLoading(false);
  };

  const handleTotpVerify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await api.post('/sa/auth/totp-verify', { code: totpCode.replace(/\s/g, '') });
      setSaUser(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Code invalide');
    }
    setLoading(false);
  };

  const goBack = () => { setStep('credentials'); setError(''); setTotpCode(''); };

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <div className="w-full max-w-sm space-y-6">

        <div className="text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-red-500 to-orange-600
                          flex items-center justify-center shadow-xl shadow-red-500/30">
            <Bot size={26} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink-1">Super Admin</h1>
            <p className="text-sm text-ink-3 mt-1">
              {step === 'credentials' && 'Accès administrateur'}
              {step === 'totp-setup'  && 'Configuration 2FA — première connexion'}
              {step === 'totp-verify' && 'Vérification 2FA'}
            </p>
          </div>
        </div>

        <div className="glass-dark rounded-2xl border border-white/[0.08] p-6 space-y-4">

          {/* Step 1 — credentials */}
          {step === 'credentials' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-ink-3">Identifiant</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="superadmin"
                  autoComplete="username"
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]
                             text-sm text-ink-1 placeholder-ink-4 outline-none
                             focus:border-red-500/50 transition-colors"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-ink-3">Mot de passe</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full px-3 py-2.5 pr-10 rounded-xl bg-white/[0.04] border border-white/[0.08]
                               text-sm text-ink-1 placeholder-ink-4 outline-none
                               focus:border-red-500/50 transition-colors"
                    required
                  />
                  <button type="button" onClick={() => setShowPass(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2">
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              {error && <p className="text-xs text-red-400 text-center">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-60
                           text-sm font-semibold text-white transition-colors
                           flex items-center justify-center gap-2">
                {loading && <Loader2 size={15} className="animate-spin" />}
                Connexion
              </button>
            </form>
          )}

          {/* Step 2a — TOTP setup (QR) */}
          {step === 'totp-setup' && (
            <form onSubmit={handleTotpSetup} className="space-y-4">
              <p className="text-xs text-ink-3 text-center">
                Scanne ce QR code avec Google Authenticator, puis entre le code.
              </p>
              {qrDataUrl && (
                <div className="flex justify-center">
                  <img src={qrDataUrl} alt="QR TOTP"
                    className="w-44 h-44 rounded-xl border border-white/[0.1] p-2 bg-white" />
                </div>
              )}
              {totpSecret && (
                <p className="text-[10px] text-center text-ink-4 font-mono break-all px-2">
                  Clé : <span className="text-ink-3 select-all">{totpSecret}</span>
                </p>
              )}
              <TotpInput value={totpCode} onChange={setTotpCode} />
              {error && <p className="text-xs text-red-400 text-center">{error}</p>}
              <button type="submit"
                disabled={loading || totpCode.replace(/\s/g, '').length < 6}
                className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-60
                           text-sm font-semibold text-white transition-colors
                           flex items-center justify-center gap-2">
                {loading ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                Confirmer
              </button>
              <BackBtn onClick={goBack} />
            </form>
          )}

          {/* Step 2b — TOTP verify */}
          {step === 'totp-verify' && (
            <form onSubmit={handleTotpVerify} className="space-y-4">
              <p className="text-xs text-ink-3 text-center">
                Entre le code généré par ton application d'authentification.
              </p>
              <TotpInput value={totpCode} onChange={setTotpCode} autoFocus />
              {error && <p className="text-xs text-red-400 text-center">{error}</p>}
              <button type="submit"
                disabled={loading || totpCode.replace(/\s/g, '').length < 6}
                className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-60
                           text-sm font-semibold text-white transition-colors
                           flex items-center justify-center gap-2">
                {loading ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                Vérifier
              </button>
              <BackBtn onClick={goBack} />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function TotpInput({ value, onChange, autoFocus }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-ink-3">Code 2FA</label>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="000 000"
        maxLength={7}
        autoFocus={autoFocus}
        className="w-full px-3 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08]
                   text-base text-ink-1 placeholder-ink-4 outline-none focus:border-red-500/50
                   text-center tracking-[0.4em] font-mono transition-colors"
      />
    </div>
  );
}

function BackBtn({ onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full py-2 text-xs text-ink-4 hover:text-ink-2 transition-colors">
      ← Retour
    </button>
  );
}
