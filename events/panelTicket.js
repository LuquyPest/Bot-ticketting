const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { globalQuery } = require('../utils/globalDb');
const { broadcast } = require('../utils/sse');

async function openTicketFromPanel(interaction, client, db, btn, formContent) {
  const user = interaction.user;
  const guildId = interaction.guildId;

  const tm = createManager(db, client, guildId);

  // Guild-wide ticket limit check (superadmin)
  const [limits] = await globalQuery('SELECT max_tickets FROM guilds WHERE guild_id = ?', [guildId]).catch(() => [{}]);
  if (limits?.max_tickets > 0) {
    const [[{ openCount }]] = await db('SELECT COUNT(*) as openCount FROM tickets WHERE status = "open"').catch(() => [[{ openCount: 0 }]]);
    if (openCount >= limits.max_tickets) {
      return interaction.editReply({ content: '❌ Le serveur a atteint sa limite de tickets simultanés. Réessaie plus tard.' });
    }
  }

  // Daily limit check
  const dailyCount = await tm.getDailyTicketCount(user.id);
  const [cfg] = await db('SELECT max_tickets_per_day FROM guild_config LIMIT 1').catch(() => [{}]);
  const maxPerDay = cfg?.max_tickets_per_day ?? 3;
  if (dailyCount >= maxPerDay) {
    return interaction.editReply({ content: `❌ Tu as déjà ouvert ${maxPerDay} ticket(s) aujourd'hui. Réessaie demain.` });
  }

  // Blacklist check
  const [bl] = await db('SELECT id FROM blacklist WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW())', [user.id]).catch(() => [null]);
  if (bl) return interaction.editReply({ content: '❌ Tu ne peux pas ouvrir de ticket.' });

  const userObj = { id: user.id, username: user.username, tag: user.tag || user.username };
  const subject = btn.subject || null;

  let content = '';
  if (formContent) content = `📋 **Formulaire :**\n${formContent}`;

  try {
    const result = await tm.createTicket(userObj, content, [], subject);
    if (result.created) {
      broadcast('new_ticket', { id: result.ticket.id, ownerTag: user.username, subject: result.ticket.subject }, guildId);
      await tm.sendWelcomeDm(user, true, subject).catch(() => null);
      await interaction.editReply({ content: `✅ Ton ticket a été créé : <#${result.channel.id}>` });
    } else {
      await interaction.editReply({ content: `ℹ️ Tu as déjà un ticket ouvert : <#${result.channel.id}>` });
    }
  } catch (err) {
    console.error('[panelTicket] error:', err);
    await interaction.editReply({ content: '❌ Impossible de créer le ticket. Réessaie dans quelques instants.' });
  }
}

module.exports = { openTicketFromPanel };
