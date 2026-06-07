import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, AlertCircle } from 'lucide-react';
import { useAuth } from '../App';

const ERROR_MESSAGES = {
  not_in_guild: "Tu n'es pas membre du serveur Discord.",
  no_permission: "Tu n'as pas le rôle requis.",
  oauth_failed: "Erreur lors de la connexion Discord. Réessaie.",
  no_code: "Code OAuth manquant."
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-20 h-20 rounded-2xl bg-indigo-600 flex items-center justify-center mb-5 shadow-2xl shadow-indigo-600/40 ring-1 ring-indigo-500/50">
            <Bot size={40} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Ticket Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1.5">Connecte-toi avec ton compte Discord</p>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2.5 bg-red-600/10 border border-red-600/25 text-red-400 text-sm px-4 py-3 rounded-xl mb-4">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Card */}
        <div className="bg-slate-900 border border-slate-800/60 rounded-2xl p-6 shadow-2xl shadow-black/40">
          <a
            href="/api/auth/discord"
            className="flex items-center justify-center gap-3 w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold text-sm transition-colors shadow-lg shadow-indigo-600/25"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.04.03.05a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
            </svg>
            Connexion avec Discord
          </a>
          <p className="text-xs text-slate-600 text-center mt-4">
            L'accès est réservé aux membres autorisés du serveur.
          </p>
        </div>
      </div>
    </div>
  );
}
