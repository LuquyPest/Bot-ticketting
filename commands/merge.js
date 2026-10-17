const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport, staffPermissionChecker } = require('../utils/permissions');
const { discordStaffCanSee } = require('../utils/gradePermissions');

// Other open tickets of the member who owns the ticket of this channel, visible to the user
async function candidates(db, channelId, userId) {
  const [ticket] = await db("SELECT id, owner_id FROM tickets WHERE channel_id = ? AND status = 'open'", [channelId]);
  if (!ticket) return { ticket: null, list: [] };
  const rows = await db("SELECT id, subject, visibility_grade_id FROM tickets WHERE owner_id = ? AND status = 'open' AND id <> ? ORDER BY id DESC", [ticket.owner_id, ticket.id]);
  const list = [];
  for (const r of rows) if (await discordStaffCanSee(db, userId, r.visibility_grade_id)) list.push(r);
  return { ticket, list };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('merge')
    .setDescription('Fusionne ce ticket dans un autre ticket ouvert du même membre')
    .addIntegerOption(o => o.setName('ticket').setDescription('Ticket qui reçoit cette conversation').setRequired(true).setAutocomplete(true)),

  async autocomplete(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const can = await staffPermissionChecker(db, interaction.user.id);
    if (!can('close_ticket')) return interaction.respond([]);
    const { list } = await candidates(db, interaction.channelId, interaction.user.id);
    await interaction.respond(list.slice(0, 25).map(t => ({ name: `#${t.id} — ${t.subject || 'Sans sujet'}`.slice(0, 100), value: t.id })));
  },

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'close_ticket'))) return;
    const can = await staffPermissionChecker(db, interaction.user.id);
    if (!can('reply_ticket')) return interaction.reply({ content: '❌ Ton grade ne donne pas la permission « Répondre aux tickets ».', flags: MessageFlags.Ephemeral });

    const { ticket, list } = await candidates(db, interaction.channelId, interaction.user.id);
    if (!ticket) return interaction.reply({ content: 'Pas un salon ticket.', flags: MessageFlags.Ephemeral });
    const target = list.find(t => t.id === interaction.options.getInteger('ticket', true));
    if (!target) return interaction.reply({ content: 'Ticket cible invalide : choisis un autre ticket ouvert de ce membre.', flags: MessageFlags.Ephemeral });

    // This channel is deleted by the merge: answer first
    await interaction.reply({ content: `🔀 Fusion dans le ticket #${target.id} en cours…`, flags: MessageFlags.Ephemeral });
    const result = await createManager(db, client, interaction.guildId).mergeTickets(ticket.id, target.id, interaction.user);
    if (!result.ok) await interaction.followUp({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral }).catch(() => null);
  },
};
