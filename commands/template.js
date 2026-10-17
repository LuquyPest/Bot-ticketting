const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { createManager } = require('../utils/ticketManager');
const { ensureSupport, staffPermissionChecker } = require('../utils/permissions');
const { checkRateLimit } = require('../utils/rateLimit');
const { sendDiscordReply, resolveTemplateVars } = require('../utils/discordReply');
const { applyMacroActions } = require('../utils/macroActions');
const { parseJsonField } = require('../utils/jsonField');
const { matchesSubject } = require('../web/routes/templates');

// Templates the staff member may use: shared ones and their own personal ones
const visibleTemplates = (db, userId) => db(
  "SELECT id, name, content, subject, actions, use_count FROM reply_templates WHERE scope = 'shared' OR created_by_id = ?", [userId]
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template')
    .setDescription('Envoie un modèle de réponse au membre (et applique ses actions si c\'est une macro)')
    .addStringOption(o => o.setName('modele').setDescription('Modèle à envoyer').setRequired(true).setAutocomplete(true))
    .addBooleanOption(o => o.setName('anonyme').setDescription('Répondre en tant que « Support »').setRequired(false)),

  // Suggestions: templates matching the ticket subject first, then the most used
  async autocomplete(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const can = await staffPermissionChecker(db, interaction.user.id);
    if (!can('reply_ticket')) return interaction.respond([]);
    const [ticket] = await db("SELECT subject FROM tickets WHERE channel_id = ? AND status = 'open'", [interaction.channelId]);
    const typed = String(interaction.options.getFocused() || '').toLowerCase();
    const rows = (await visibleTemplates(db, interaction.user.id))
      .map(t => ({ ...t, suggested: ticket?.subject ? matchesSubject(t.subject, ticket.subject) : false }))
      .filter(t => !typed || t.name.toLowerCase().includes(typed))
      .sort((a, b) => (b.suggested - a.suggested) || (b.use_count - a.use_count) || a.name.localeCompare(b.name))
      .slice(0, 25);
    await interaction.respond(rows.map(t => ({
      name: `${t.suggested ? '⭐ ' : ''}${t.name}${t.actions ? ' (macro)' : ''}`.slice(0, 100),
      value: String(t.id),
    })));
  },

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const tm = createManager(db, client, interaction.guildId);
    if (!(await ensureSupport(interaction, client, db, 'reply_ticket'))) return;

    const ticket = await tm.getOpenTicketByChannelId(interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'Pas un salon ticket.', flags: MessageFlags.Ephemeral });
    const tpl = (await visibleTemplates(db, interaction.user.id)).find(t => String(t.id) === interaction.options.getString('modele', true));
    if (!tpl) return interaction.reply({ content: 'Modèle introuvable : choisis-le dans la liste proposée.', flags: MessageFlags.Ephemeral });

    const cfg = await tm.getGuildConfig(db);
    const cooldown = (cfg.reply_rate_limit_seconds ?? 3) * 1000;
    const remaining = await checkRateLimit(`reply:${interaction.user.id}:${interaction.guildId}`, cooldown);
    if (remaining > 0) return interaction.reply({ content: `Attends encore ${remaining}s avant de renvoyer une réponse.`, flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await sendDiscordReply({
      client, db, tm, guildId: interaction.guildId, ticket, author: interaction.user, channel: interaction.channel,
      content: resolveTemplateVars(tpl.content, ticket, interaction.user.username), anonymous: !!interaction.options.getBoolean('anonyme'),
    });
    await db('UPDATE reply_templates SET use_count = use_count + 1 WHERE id = ?', [tpl.id]);

    const actions = tpl.actions ? parseJsonField(tpl.actions, null) : null;
    const { applied, warnings } = await applyMacroActions({
      client, db, tm, ticket, actions, actor: interaction.user, can: await staffPermissionChecker(db, interaction.user.id),
    });
    const summary = [`Modèle « ${tpl.name} » envoyé.`, applied.length ? `Actions : ${applied.join(', ')}.` : null, ...warnings.map(w => `⚠️ ${w}`)];
    await interaction.editReply({ content: summary.filter(Boolean).join('\n') }).catch(() => null);
  },
};
