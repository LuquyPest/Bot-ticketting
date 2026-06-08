import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, AlertCircle, Zap } from 'lucide-react';
import { useAuth } from '../App';

const ERROR_MESSAGES = {
  not_in_guild: "Tu n'es pas membre du serveur Discord.",
  no_permission: "Tu n'as pas le rôle requis.",
  oauth_failed:  "Erreur lors de la connexion Discord. Réessaie.",
  no_code:       "Code OAuth manquant.",
};

export default function Login() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) navigate(user.role === 'nouveau' ? '/pending' : '/', { replace: true });
    const err = params.get('error');
    if (err) setError(ERROR_MESSAGES[err] || 'Erreur inconnue.');
  }, [user]);

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4 relative overflow-hidden">

      {/* Animated orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="animate-orb-1 absolute -top-32 -left-32 w-96 h-96
                        rounded-full bg-primary/20 blur-[80px]" />
        <div className="animate-orb-2 absolute -bottom-32 -right-32 w-[28rem] h-[28rem]
                        rounded-full bg-violet-600/15 blur-[100px]" />
        <div className="animate-orb-3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                        w-80 h-80 rounded-full bg-indigo-600/10 blur-[90px]" />
      </div>

      {/* Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }}
      />

      <div className="w-full max-w-sm relative z-10 animate-slide-up">

        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="relative mb-5">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 via-primary to-indigo-600
                            flex items-center justify-center shadow-primary">
              <Bot size={38} className="text-white" />
            </div>
            {/* Glow ring */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600
                            opacity-30 blur-xl -z-10 animate-glow-pulse" />
          </div>
          <h1 className="text-2xl font-bold text-ink-1 tracking-tight">Ticket Dashboard</h1>
          <p className="text-sm text-ink-3 mt-1.5">Gestion des tickets de support</p>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2.5 bg-red-500/8 border border-red-500/20
                          text-red-400 text-sm px-4 py-3 rounded-xl mb-4 animate-fade-in">
            <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Card */}
        <div className="relative bg-surface-card border border-white/[0.07] rounded-2xl p-6
                        shadow-[0_8px_48px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.05)]">
          {/* Top glow line */}
          <div className="absolute top-0 left-8 right-8 h-px
                          bg-gradient-to-r from-transparent via-primary/40 to-transparent rounded-full" />

          <a
            href="/api/auth/discord"
            className="flex items-center justify-center gap-3 w-full py-3 px-4 rounded-xl
                       bg-[#5865F2] hover:bg-[#4752c4] active:bg-[#3c45a5]
                       text-white font-semibold text-sm transition-all duration-150
                       shadow-[0_4px_16px_rgba(88,101,242,0.4)]
                       hover:shadow-[0_4px_24px_rgba(88,101,242,0.5)]
                       hover:-translate-y-px active:translate-y-0"
          >
            {/* Discord logo */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.04.03.05a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
            </svg>
            Connexion avec Discord
          </a>

          <div className="flex items-center gap-2 mt-5">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[10px] text-ink-4 font-medium uppercase tracking-wider">Accès restreint</span>
            <div className="h-px flex-1 bg-white/[0.06]" />
          </div>

          <div className="flex items-center justify-center gap-1.5 mt-4">
            <Zap size={11} className="text-primary-light/60" />
            <p className="text-xs text-ink-4 text-center">
              Réservé aux membres autorisés du serveur
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
