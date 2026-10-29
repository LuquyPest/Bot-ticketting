const { createManager } = require('./ticketManager');
const { globalQuery } = require('./globalDb');
const { broadcast } = require('./sse');
const { t } = require('./i18n');

async function openTicketFromPanel(interaction, client, db, btn, formContent, subjectOverride = null) {
  const user = interaction.user;
  const guildId = interaction.guildId;

  const tm = createManager(db, client, guildId);

  // Guild-wide ticket limit check (superadmin)
  const [limits] = await globalQuery('SELECT max_tickets FROM guilds WHERE guild_id = ?', [guildId]).catch(() => [{}]);
  if (limits?.max_tickets > 0) {
    const [{ openCount }] = await db('SELECT COUNT(*) as openCount FROM tickets WHERE status = "open"').catch(() => [{ openCount: 0 }]);
    if (openCount >= limits.max_tickets) {
      return interaction.editReply({ content: t('panel.serverLimit') });
    }
  }

  // Daily limit check
  const dailyCount = await tm.getDailyTicketCount(user.id);
  const [cfg] = await db('SELECT max_tickets_per_day FROM guild_config LIMIT 1').catch(() => [{}]);
  const maxPerDay = cfg?.max_tickets_per_day ?? 3;
  if (dailyCount >= maxPerDay) {
    return interaction.editReply({ content: t('panel.dailyLimit', { max: maxPerDay }) });
  }

  // Blacklist check
  const [bl] = await db('SELECT id FROM blacklist WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW())', [user.id]).catch(() => [null]);
  if (bl) return interaction.editReply({ content: t('panel.blacklisted') });

  const userObj = { id: user.id, username: user.username, tag: user.tag || user.username };
  const subject = (subjectOverride || btn.subject || '').replace(/\s+/g, ' ').trim().slice(0, 100) || null;

  let content = '';
  if (formContent) content = `${t('panel.form')}\n${formContent}`;

  try {
    // A member may have several tickets: a panel click always opens a new one (daily limit applies)
    const result = await tm.createTicket(userObj, content, [], subject, { forceNew: true });
    if (result.created) {
      broadcast('new_ticket', { id: result.ticket.id, ownerTag: user.username, subject: result.ticket.subject }, guildId);
      await tm.sendWelcomeDm(user, true, subject, result.ticket.id).catch(() => null);
      // The ticket channel is private to the staff: the member follows the ticket in DM
      await interaction.editReply({ content: t('panel.created', { id: result.ticket.id }) });
    } else {
      await interaction.editReply({ content: t('panel.exists', { id: result.ticket.id }) });
    }
  } catch (err) {
    if (err.code === 'TICKET_CAPACITY') return interaction.editReply({ content: t('panel.serverLimit') });
    console.error('[panelTicket] error:', err);
    await interaction.editReply({ content: t('panel.failed') });
  }
}

module.exports = { openTicketFromPanel };
