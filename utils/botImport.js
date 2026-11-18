// Taking over the open tickets of another ticket bot (Ticket Tool, Tickets, Helper.gg…): those bots
// keep a channel per ticket, with a permission overwrite for the member who opened it. The founder
// picks the category where the other bot puts its tickets; each text channel there becomes a ticket
// of this bot, owned by the member found in its permissions (or in its topic), with optionally:
// its last messages copied into the history, the channel moved to the « Ouvert » category, and a DM
// telling the member they can now simply reply to this bot. Nothing is deleted: the channels stay.
const { ChannelType, OverwriteType, PermissionsBitField } = require('discord.js');
const { parseJsonField } = require('./jsonField');
const { fetchGuildChannel } = require('./discordGuard');

const MAX_CHANNELS = 200;
const HISTORY_LIMIT = 100;
const SNOWFLAKE = /^\d{17,20}$/;

async function staffIds(db) {
  return new Set((await db("SELECT user_id FROM dashboard_users WHERE role IN ('support', 'fondateur')")).map(r => r.user_id));
}

// Member who opened the ticket: a member overwrite allowing ViewChannel (not the bot, not the staff,
// not a bot account), else the first user mentioned or quoted in the topic
async function detectOwner(client, guild, channel, staff) {
  const candidates = [];
  for (const ow of channel.permissionOverwrites?.cache?.values?.() || []) {
    if (ow.type !== OverwriteType.Member || ow.id === client.user.id || staff.has(ow.id)) continue;
    if (!ow.allow?.has?.(PermissionsBitField.Flags.ViewChannel)) continue;
    candidates.push(ow.id);
  }
  for (const m of String(channel.topic || '').matchAll(/<@!?(\d{17,20})>|\b(\d{17,20})\b/g)) {
    const id = m[1] || m[2];
    if (!staff.has(id) && id !== client.user.id && !candidates.includes(id)) candidates.push(id);
  }
  for (const id of candidates) {
    const member = await guild.members.fetch(id).catch(() => null);
    const user = member?.user || await client.users.fetch(id).catch(() => null);
    if (user && !user.bot) return { id: user.id, tag: user.tag || user.username || user.id };
  }
  return null;
}

// Text channels of the category, with the member found for each
async function scanCategory(client, guildId, db, categoryId) {
  if (!SNOWFLAKE.test(String(categoryId || ''))) return { error: 'Catégorie invalide' };
  const category = await fetchGuildChannel(client, guildId, categoryId);
  if (category?.type !== ChannelType.GuildCategory) return { error: 'Catégorie introuvable sur ce serveur' };
  const guild = await client.guilds.fetch(guildId);
  const all = await guild.channels.fetch();
  const inCat = [...all.values()].filter(c => c && c.parentId === categoryId && c.type === ChannelType.GuildText).slice(0, MAX_CHANNELS);
  const staff = await staffIds(db);
  const ids = inCat.map(c => c.id);
  const adopted = new Set(ids.length ? (await db(`SELECT channel_id FROM tickets WHERE channel_id IN (${ids.map(() => '?').join(',')})`, ids)).map(r => r.channel_id) : []);
  const channels = [];
  for (const c of inCat) {
    const owner = adopted.has(c.id) ? null : await detectOwner(client, guild, c, staff);
    channels.push({ channelId: c.id, name: c.name, owner, adopted: adopted.has(c.id) });
  }
  return { category: { id: category.id, name: category.name }, channels };
}

// Copies the last messages of the channel into the ticket history (member → « user », staff → « reply »)
async function importHistory(db, channel, ticketId, ownerId) {
  const fetched = await channel.messages.fetch({ limit: HISTORY_LIMIT }).catch(() => null);
  const list = [...(fetched?.values?.() || [])].filter(m => !m.author?.bot).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  let n = 0;
  for (const m of list) {
    const files = [...(m.attachments?.values?.() || [])].map(a => `📎 ${a.name} ${a.url}`);
    const content = [m.content, ...files].filter(Boolean).join('\n').slice(0, 8000);
    if (!content) continue;
    await db('INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [ticketId, m.author.id, (m.author.tag || m.author.username || m.author.id).slice(0, 100), content, m.author.id === ownerId ? 'user' : 'reply', new Date(m.createdTimestamp)]);
    n++;
  }
  return n;
}

// items: [{ channelId, ownerId }] from the scan (the owner may be corrected by hand)
async function adoptChannels(client, guildId, db, actor, { categoryId, items, history = true, notify = true, move = false }) {
  const scan = await scanCategory(client, guildId, db, categoryId);
  if (scan.error) return scan;
  if (!Array.isArray(items) || !items.length) return { error: 'Aucun salon choisi' };
  const byId = new Map(scan.channels.map(c => [c.channelId, c]));
  const [cfg] = await db('SELECT ticket_category_id FROM guild_config WHERE id = 1');
  const guild = await client.guilds.fetch(guildId);
  const { broadcast } = require('./sse');
  const { sendToMember, t } = require('./i18n');
  const result = { adopted: [], skipped: [] };

  for (const item of items.slice(0, MAX_CHANNELS)) {
    const found = byId.get(String(item?.channelId));
    if (!found) { result.skipped.push({ channelId: item?.channelId, reason: 'Salon absent de cette catégorie' }); continue; }
    if (found.adopted) { result.skipped.push({ channelId: found.channelId, name: found.name, reason: 'Déjà repris' }); continue; }
    const ownerId = SNOWFLAKE.test(String(item.ownerId || '')) ? String(item.ownerId) : found.owner?.id;
    const member = ownerId ? await guild.members.fetch(ownerId).catch(() => null) : null;
    const ownerUser = member ? (member.user || await client.users.fetch(member.id).catch(() => null)) : null;
    if (!member || !ownerUser || ownerUser.bot) { result.skipped.push({ channelId: found.channelId, name: found.name, reason: 'Membre introuvable sur le serveur' }); continue; }
    const channel = await fetchGuildChannel(client, guildId, found.channelId);
    if (!channel) { result.skipped.push({ channelId: found.channelId, name: found.name, reason: 'Salon inaccessible' }); continue; }
    // An owner chosen by hand must have been able to read this channel: otherwise its history would
    // become readable by them (member space) — a channel of someone else, handed to another member
    if (ownerId !== found.owner?.id && !channel.permissionsFor?.(member)?.has?.(PermissionsBitField.Flags.ViewChannel)) {
      result.skipped.push({ channelId: found.channelId, name: found.name, reason: 'Ce membre ne voit pas ce salon' }); continue;
    }

    // The bot must be able to write in and manage the channel from now on
    await channel.permissionOverwrites?.edit?.(client.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, ManageChannels: true, AttachFiles: true }).catch(() => null);
    const tag = (ownerUser.tag || ownerUser.username || member.id).slice(0, 100);
    const ins = await db('INSERT INTO tickets (channel_id, owner_id, owner_tag, subject, created_at, last_message_at, stage_changed_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [channel.id, member.id, tag, String(channel.name).slice(0, 100), channel.createdAt || new Date()]);
    const ticketId = Number(ins.insertId);
    const copied = history ? await importHistory(db, channel, ticketId, member.id) : 0;
    await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, ?, ?, ?, 'system')",
      [ticketId, actor.id, actor.username.slice(0, 100), `Ticket repris depuis un autre bot (salon #${channel.name})${history ? ` — ${copied} message(s) importé(s)` : ''}.`]);
    if (move && cfg?.ticket_category_id && channel.parentId !== cfg.ticket_category_id) {
      await channel.setParent(cfg.ticket_category_id, { lockPermissions: false }).catch(() => null);
    }
    if (notify) {
      await sendToMember(client, member.id, guildId, () => ({ embeds: [{ title: t('adopted.title'), description: t('adopted.body', { guild: guild.name, id: ticketId }), color: 0x2f6feb }] }), { ticketId: ticketId });
    }
    broadcast('ticket', { id: ticketId, status: 'open' }, guildId);
    result.adopted.push({ ticketId, channelId: channel.id, name: channel.name, ownerId: member.id, messages: copied });
  }
  const { logAudit } = require('./gradePermissions');
  await logAudit(actor.id, actor.username, 'bot_import', 'guild', guildId,
    { category: scan.category.name, adopted: result.adopted.length, skipped: result.skipped.length, history, notify, move }, db);
  return result;
}

module.exports = { scanCategory, adoptChannels, detectOwner, MAX_CHANNELS };
