import React, { useEffect, useState, useCallback } from 'react';
import { Bot, ChevronRight, Loader2, ExternalLink, Clock, Ban, RefreshCw } from 'lucide-react';
import { useAuth } from '../App';
import api from '../api';

function GuildIcon({ guild }) {
  const [error, setError] = useState(false);
  if (guild.iconUrl && !error) {
    return (
      <img
        src={guild.iconUrl}
        alt=""
        className="w-12 h-12 rounded-xl ring-1 ring-white/10 object-cover flex-shrink-0"
        onError={() => setError(true)}
      />
    );
  }
  const initial = guild.name?.charAt(0)?.toUpperCase() || '?';
  return (
    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600
                    flex items-center justify-center flex-shrink-0 text-white font-bold text-lg select-none">
      {initial}
    </div>
  );
}

const STATUS_BADGE = {
  active:    { label: 'Actif',         cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' },
  pending:   { label: 'En attente',    cls: 'text-amber-300  bg-amber-500/10  border-amber-500/20'    },
  suspended: { label: 'Suspendu',      cls: 'text-red-400    bg-red-500/10    border-red-500/20'      },
  not_added: { label: 'Non configuré', cls: 'text-ink-4      bg-white/5       border-white/10'        },
};

export default function GuildSelect() {
  const { selectGuild } = useAuth();
  const [guilds, setGuilds]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selecting, setSelecting] = useState(null);
  const [inviting, setInviting]   = useState(null);
  const [error, setError]         = useState(null);
  const [selectErr, setSelectErr] = useState(null);

  const fetchGuilds = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/auth/guilds')
      .then(r => setGuilds(r.data))
      .catch(err => {
        if (err.response?.status === 401) {
          window.location.href = '/login';
        } else {
          setError('Impossible de charger les serveurs.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchGuilds(); }, [fetchGuilds]);

  const handleSelect = async (guildId) => {
    if (selecting) return;
    setSelectErr(null);
    setSelecting(guildId);
    try {
      await selectGuild(guildId);
    } catch (err) {
      setSelecting(null);
      if (err.response?.status === 403) {
        setSelectErr('Tu n\'as pas accès au dashboard de ce serveur. Contacte le fondateur.');
      } else if (err.response?.status === 404) {
        setSelectErr('Ce serveur n\'est pas encore actif.');
      } else {
        setSelectErr('Erreur lors de la sélection — réessaie.');
      }
    }
  };

  const handleInvite = async (guildId) => {
    if (inviting) return;
    setInviting(guildId);
    try {
      const { data } = await api.get(`/auth/invite-url?guildId=${guildId}`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      setSelectErr('Impossible de générer le lien d\'invitation.');
    } finally {
      setInviting(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4 py-10">
      <div className="w-full max-w-lg space-y-5">

        {/* Header */}
        <div className="text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-violet-500 via-primary to-indigo-600
                          flex items-center justify-center shadow-xl shadow-primary/30">
            <Bot size={26} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink-1">Mes serveurs</h1>
            <p className="text-sm text-ink-3 mt-1">Choisis un serveur pour accéder au dashboard</p>
          </div>
        </div>

        {/* Inline error */}
        {selectErr && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400 text-center">
            {selectErr}
          </div>
        )}

        {/* Guild list */}
        <div className="glass-dark rounded-2xl border border-white/[0.08] overflow-hidden divide-y divide-white/[0.04]">
          {loading && (
            <div className="flex items-center justify-center py-14">
              <Loader2 size={22} className="animate-spin text-primary-light" />
            </div>
          )}

          {!loading && error && (
            <div className="px-5 py-10 text-center space-y-3">
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={fetchGuilds}
                className="text-xs text-ink-3 hover:text-ink-1 transition-colors"
              >
                Réessayer
              </button>
            </div>
          )}

          {!loading && !error && guilds.length === 0 && (
            <div className="px-5 py-12 text-center space-y-2">
              <p className="text-sm text-ink-3">Aucun serveur trouvé.</p>
              <p className="text-xs text-ink-4">
                Tu dois avoir la permission «&nbsp;Gérer le serveur&nbsp;» pour configurer le bot.
              </p>
            </div>
          )}

          {!loading && !error && guilds.map(guild => {
            const badge = STATUS_BADGE[guild.status] || STATUS_BADGE.not_added;
            const isSel = selecting === guild.id;
            const isInv = inviting  === guild.id;

            return (
              <div key={guild.id} className="flex items-center gap-4 px-5 py-4">
                <GuildIcon guild={guild} />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-1 truncate leading-tight">{guild.name}</p>
                  <span className={`inline-flex items-center mt-1 text-[10px] font-bold uppercase
                                   tracking-wide px-1.5 py-0.5 rounded-md border ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>

                {/* active → accéder */}
                {guild.status === 'active' && (
                  <button
                    onClick={() => handleSelect(guild.id)}
                    disabled={!!selecting}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                               bg-primary/20 text-primary-light border border-primary/30
                               hover:bg-primary/30 transition-colors
                               disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    {isSel
                      ? <Loader2 size={13} className="animate-spin" />
                      : <ChevronRight size={13} />
                    }
                    {isSel ? 'Connexion…' : 'Accéder'}
                  </button>
                )}

                {/* pending → attente */}
                {guild.status === 'pending' && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                   text-amber-300/60 border border-amber-500/20 flex-shrink-0 cursor-default select-none">
                    <Clock size={13} />
                    En attente
                  </span>
                )}

                {/* suspended → suspendu */}
                {guild.status === 'suspended' && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                   text-red-400/60 border border-red-500/20 flex-shrink-0 cursor-default select-none">
                    <Ban size={13} />
                    Suspendu
                  </span>
                )}

                {/* not_added → inviter */}
                {guild.status === 'not_added' && (
                  <button
                    onClick={() => handleInvite(guild.id)}
                    disabled={!!inviting}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                               bg-indigo-500/20 text-indigo-300 border border-indigo-500/30
                               hover:bg-indigo-500/30 transition-colors
                               disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    {isInv
                      ? <Loader2 size={13} className="animate-spin" />
                      : <ExternalLink size={13} />
                    }
                    {isInv ? 'Ouverture…' : 'Inviter le bot'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Refresh */}
        {!loading && !error && (
          <button
            onClick={fetchGuilds}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs text-ink-4
                       hover:text-ink-2 transition-colors"
          >
            <RefreshCw size={12} />
            Actualiser
          </button>
        )}
      </div>
    </div>
  );
}
