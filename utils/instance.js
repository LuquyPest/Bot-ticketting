// The instance and its owner. Whoever installs the bot owns the instance: the owner of the
// Discord application (or, for an application owned by a team, its owner and admins), plus the
// accounts listed in OWNER_IDS. The owner manages the instance from the dashboard (« Instance »
// section) and is founder on every server of the instance. No separate account, no password.
const { config } = require('./config');

const CACHE_MS = 10 * 60 * 1000;
let cache = { ids: null, at: 0 };

const SNOWFLAKE = /^\d{17,20}$/;
const configured = () => (Array.isArray(config.ownerIds) ? config.ownerIds.filter(id => SNOWFLAKE.test(id)) : []);

// Discord IDs of the instance owners (application owner or team owner/admins, then OWNER_IDS)
async function ownerIds(client) {
  if (cache.ids && Date.now() - cache.at < CACHE_MS) return cache.ids;
  const ids = new Set(configured());
  try {
    const app = await client?.application?.fetch();
    const owner = app?.owner;
    if (owner?.members) { // Team
      if (owner.ownerId) ids.add(owner.ownerId);
      for (const m of owner.members.values()) if (m.role === 'admin' || m.role === undefined) ids.add(m.id ?? m.user?.id);
    } else if (owner?.id) {
      ids.add(owner.id);
    }
  } catch { /* Discord unreachable: the configured owners still work */ }
  ids.delete(undefined);
  const list = [...ids];
  // An empty answer (Discord down at boot) is not cached for long
  cache = { ids: list, at: list.length ? Date.now() : Date.now() - CACHE_MS + 30 * 1000 };
  return list;
}

async function isOwner(client, userId) {
  if (!userId) return false;
  return (await ownerIds(client)).includes(String(userId));
}

// Name shown in the dashboard, the DMs and the exports: the bot's own Discord name
function instanceName(client) {
  return client?.user?.username || 'Ticket Bot';
}

function instanceAvatar(client) {
  return client?.user?.displayAvatarURL?.({ size: 128 }) || null;
}

function resetOwnerCache() { cache = { ids: null, at: 0 }; }

module.exports = { ownerIds, isOwner, instanceName, instanceAvatar, resetOwnerCache };
