import React, { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, Check, Loader2 } from 'lucide-react';
import { useAuth } from '../App';
import api from '../api';

function GuildIcon({ guild, size = 'sm' }) {
  const [error, setError] = useState(false);
  const cls = size === 'sm' ? 'w-5 h-5 rounded-md' : 'w-7 h-7 rounded-lg';
  if (guild?.guild_icon && !error) {
    return (
      <img
        src={`https://cdn.discordapp.com/icons/${guild.guild_id}/${guild.guild_icon}.webp?size=32`}
        alt=""
        className={`${cls} ring-1 ring-white/10 object-cover flex-shrink-0`}
        onError={() => setError(true)}
      />
    );
  }
  return (
    <div className={`${cls} bg-gradient-to-br from-violet-500 to-indigo-600
                    flex items-center justify-center flex-shrink-0`}>
      <Building2 size={size === 'sm' ? 10 : 13} className="text-white" />
    </div>
  );
}

export default function GuildSwitcher() {
  const { user, selectGuild } = useAuth();
  const [open, setOpen]         = useState(false);
  const [guilds, setGuilds]     = useState([]);
  const [loaded, setLoaded]     = useState(false);
  const [switching, setSwitching] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOpen = () => {
    setOpen(o => !o);
    if (!loaded) {
      api.get('/auth/guilds').then(r => { setGuilds(r.data); setLoaded(true); }).catch(() => {});
    }
  };

  const handleSwitch = async (guildId) => {
    if (guildId === user?.guildId || switching) return;
    setSwitching(guildId);
    try {
      await selectGuild(guildId);
    } catch {
      setSwitching(null);
    }
  };

  const currentGuild = guilds.find(g => g.guild_id === user?.guildId);
  const currentName = currentGuild?.guild_name || 'Serveur';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl w-full
                   text-xs font-medium text-ink-2 hover:text-ink-1
                   hover:bg-white/[0.05] transition-all duration-150 group"
        title="Changer de serveur"
      >
        {currentGuild
          ? <GuildIcon guild={currentGuild} size="sm" />
          : <div className="w-5 h-5 rounded-md bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Building2 size={10} className="text-primary-light" />
            </div>
        }
        <span className="flex-1 truncate text-left">{currentName}</span>
        <ChevronDown
          size={12}
          className={`flex-shrink-0 text-ink-4 group-hover:text-ink-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 w-full z-50
                        glass-dark rounded-xl border border-white/[0.1] shadow-xl shadow-black/50
                        overflow-hidden py-1">
          {!loaded && (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={14} className="animate-spin text-primary-light" />
            </div>
          )}
          {loaded && guilds.map(guild => {
            const isActive = guild.guild_id === user?.guildId;
            const isSwitching = switching === guild.guild_id;
            return (
              <button
                key={guild.guild_id}
                onClick={() => handleSwitch(guild.guild_id)}
                disabled={isActive || !!switching}
                className={`w-full flex items-center gap-2.5 px-3 py-2
                            text-xs transition-all duration-100
                            ${isActive
                              ? 'text-ink-1 bg-primary/10 cursor-default'
                              : 'text-ink-3 hover:text-ink-1 hover:bg-white/[0.05]'}
                            disabled:opacity-60`}
              >
                <GuildIcon guild={guild} size="sm" />
                <span className="flex-1 truncate text-left font-medium">{guild.guild_name}</span>
                {isSwitching
                  ? <Loader2 size={11} className="animate-spin text-primary-light flex-shrink-0" />
                  : isActive
                    ? <Check size={11} className="text-primary-light flex-shrink-0" />
                    : null
                }
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
