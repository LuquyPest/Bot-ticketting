import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '../App';
import api from '../api';

export default function TotpVerify() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [code, setCode]     = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user && !user.needsTotp) navigate('/', { replace: true });
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await api.post('/auth/totp-verify-login', { code });
      window.location.href = r.data.redirect || '/';
    } catch (err) {
      setError(err.response?.data?.error || 'Code invalide');
    }
    setLoading(false);
  };

  const handleCancel = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <div className="w-full max-w-sm space-y-6">

        {/* Icon + title */}
        <div className="text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600
                          flex items-center justify-center shadow-xl shadow-primary/30">
            <ShieldCheck size={26} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink-1">Vérification 2FA</h1>
            {user?.username && (
              <p className="text-sm text-ink-3 mt-1">
                Bienvenue, <span className="text-ink-2 font-medium">{user.username}</span>
              </p>
            )}
          </div>
        </div>

        {/* Form */}
        <div className="glass-dark rounded-2xl border border-white/[0.08] p-6 space-y-4">
          <p className="text-xs text-ink-3 text-center">
            Entre le code généré par ton application d'authentification pour accéder au dashboard.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-3">Code 2FA</label>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="000 000"
                maxLength={7}
                autoFocus
                className="w-full px-3 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08]
                           text-base text-ink-1 placeholder-ink-4 outline-none
                           focus:border-primary/50 text-center tracking-[0.4em] font-mono transition-colors"
              />
            </div>

            {error && <p className="text-xs text-red-400 text-center">{error}</p>}

            <button type="submit"
              disabled={loading || code.replace(/\s/g, '').length < 6}
              className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary-light disabled:opacity-60
                         text-sm font-semibold text-white transition-colors
                         flex items-center justify-center gap-2">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
              Vérifier
            </button>
          </form>

          <button type="button" onClick={handleCancel}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs text-ink-4
                       hover:text-ink-2 transition-colors">
            <LogOut size={12} />
            Annuler et se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
