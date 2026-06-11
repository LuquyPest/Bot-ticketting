import React, { useEffect, useState } from 'react';
import { Bot, Building2, ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '../App';
import api from '../api';

function GuildAvatar({ guild }) {
  const [error, setError] = useState(false);
  if (guild.guild_icon && !error) {
    return (
      <img
        src={`https://cdn.discordapp.com/icons/${guild.guild_id}/${guild.guild_icon}.webp?size=64`}
        alt=""
        className="w-12 h-12 rounded-xl ring-1 ring-white/10 object-cover flex-shrink-0"
        onError={() => setError(true)}
      />
    );
  }
  return (
    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600
                    flex items-center justify-center flex-shrink-0">
      <Building2 size={20} className="text-white" />
    </div>
  );
}

const ROLE_LABEL = {
  fondateur: { label: 'Fondateur', cls: 'text-violet-300 bg-violet-500/10 border-violet-500/20' },
  support:   { label: 'Support',   cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' },
};

export default function GuildSelect() {
  const { selectGuild } = useAuth();
  const [guilds, setGuilds]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selecting, setSelecting] = useState(null);
  const [error, setError]       = useState(null);

  useEffect(() => {
    api.get('/auth/guilds')
      .then(r => setGuilds(r.data))
      .catch(() => setError('Impossible de charger les serveurs.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = async (guildId) => {
    if (selecting) return;
    setSelecting(guildId);
    try {
      await selectGuild(guildId);
    } catch {
      setSelecting(null);
      setError('Erreur lors de la sélection du serveur.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <div className="w-full max-w-md space-y-6">

        {/* Header */}
        <div className="text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-violet-500 via-primary to-indigo-600
                          flex items-center justify-center shadow-xl shadow-primary/30">
            <Bot size={26} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink-1">Sélectionner un serveur</h1>
            <p className="text-sm text-ink-3 mt-1">Sur quel serveur veux-tu travailler ?</p>
          </div>
        </div>

        {/* Guild list */}
        <div className="glass-dark rounded-2xl border border-white/[0.08] overflow-hidden divide-y divide-white/[0.04]">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={22} className="animate-spin text-primary-light" />
            </div>
          )}

          {!loading && error && (
            <div className="px-5 py-8 text-center text-sm text-red-400">{error}</div>
          )}

          {!loading && !error && guilds.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-ink-3">
              Aucun serveur accessible. Contacte un administrateur.
            </div>
          )}

          {!loading && guilds.map(guild => {
            const roleStyle = ROLE_LABEL[guild.role] || ROLE_LABEL.support;
            const isSelecting = selecting === guild.guild_id;
            return (
              <button
                key={guild.guild_id}
                onClick={() => handleSelect(guild.guild_id)}
                disabled={!!selecting}
                className="w-full flex items-center gap-4 px-5 py-4 text-left
                           hover:bg-white/[0.04] transition-all duration-150
                           disabled:opacity-60 disabled:cursor-not-allowed group"
              >
                <GuildAvatar guild={guild} />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-1 truncate leading-tight">{guild.guild_name}</p>
                  <span className={`inline-flex items-center mt-1 text-[10px] font-bold uppercase
                                   tracking-wide px-1.5 py-0.5 rounded-md border ${roleStyle.cls}`}>
                    {roleStyle.label}
                  </span>
                </div>

                {isSelecting
                  ? <Loader2 size={16} className="animate-spin text-primary-light flex-shrink-0" />
                  : <ChevronRight size={16} className="text-ink-4 group-hover:text-ink-2 flex-shrink-0 transition-colors" />
                }
              </button>
            );
          })}
        </div>

        {error && !loading && (
          <button
            onClick={() => { setError(null); setLoading(true); api.get('/auth/guilds').then(r => setGuilds(r.data)).catch(() => setError('Erreur.')).finally(() => setLoading(false)); }}
            className="w-full py-2.5 text-sm text-ink-3 hover:text-ink-1 transition-colors"
          >
            Réessayer
          </button>
        )}
      </div>
    </div>
  );
}
