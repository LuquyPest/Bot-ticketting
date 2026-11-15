// /setup — setup wizard on Discord, for the founders: staff roles, ticket categories (existing ones,
// or created by the bot) and a ticket panel, in three steps, without opening the dashboard.
// The settings go through the same validation, history and audit log as the Settings page
// (applyConfigUpdates in web/routes/config.js). Staff-facing: French, like the other commands.
const {
  SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, PermissionsBitField,
} = require('discord.js');
const { getTenantDb } = require('../utils/tenantDb');
const { parseJsonField } = require('../utils/jsonField');

const TTL_S = 15 * 60;
const key = (guildId, userId) => `setup:${guildId}:${userId}`;
const redis = () => require('../utils/redis').getRedis();
const CATEGORY_NAMES = { open: '📨 Tickets ouverts', waiting: '⏳ Tickets en attente', progress: '🛠️ Tickets en cours' };

async function loadState(guildId, userId) {
  try { return JSON.parse(await redis().get(key(guildId, userId))) || null; } catch { return null; }
}
async function saveState(guildId, userId, state) {
  await redis().set(key(guildId, userId), JSON.stringify(state), 'EX', TTL_S);
}

// Founders of the server and owners of the instance only
async function isFounder(client, db, userId) {
  const [u] = await db('SELECT role FROM dashboard_users WHERE user_id = ?', [userId]).catch(() => []);
  if (u?.role === 'fondateur') return true;
  return require('../utils/instance').isOwner(client, userId).catch(() => false);
}

const embed = (step, title, description) => new EmbedBuilder()
  .setColor(0x2f6feb).setTitle(`🧭 Configuration — ${step}/3 · ${title}`).setDescription(description);
const btn = (id, label, style = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder().setCustomId(`setup:${id}`).setLabel(label).setStyle(style).setDisabled(disabled);

function stepRoles(state) {
  const support = new RoleSelectMenuBuilder().setCustomId('setup:support').setPlaceholder('Rôles support (accès aux tickets)').setMinValues(0).setMaxValues(10);
  const chief = new RoleSelectMenuBuilder().setCustomId('setup:chief').setPlaceholder('Rôles chef support (facultatif)').setMinValues(0).setMaxValues(10);
  if (state.support.length) support.setDefaultRoles(state.support.slice(0, 10));
  if (state.chief.length) chief.setDefaultRoles(state.chief.slice(0, 10));
  return {
    embeds: [embed(1, 'Rôles du staff', 'Les membres qui ont ces rôles Discord voient les tickets et obtiennent un compte sur le dashboard à leur connexion.\n\nChoisis au moins un rôle support.')],
    components: [
      new ActionRowBuilder().addComponents(support),
      new ActionRowBuilder().addComponents(chief),
      new ActionRowBuilder().addComponents(btn('next1', 'Continuer', ButtonStyle.Primary, !state.support.length), btn('cancel', 'Annuler')),
    ],
  };
}

function stepCategories(state) {
  const pick = (id, ph, value) => {
    const m = new ChannelSelectMenuBuilder().setCustomId(`setup:${id}`).setPlaceholder(ph).setChannelTypes(ChannelType.GuildCategory).setMinValues(0).setMaxValues(1);
    if (value) m.setDefaultChannels([value]);
    return new ActionRowBuilder().addComponents(m);
  };
  return {
    embeds: [embed(2, 'Catégories des tickets', 'Une catégorie Discord par étape : changer l\'étape d\'un ticket déplace son salon.\n\nChoisis des catégories existantes, ou laisse le bot les créer (masquées à tout le monde sauf au staff).')],
    components: [
      pick('cat_open', 'Catégorie « Ouvert »', state.categories.open),
      pick('cat_waiting', 'Catégorie « En attente » (facultatif)', state.categories.waiting),
      pick('cat_progress', 'Catégorie « En cours » (facultatif)', state.categories.progress),
      new ActionRowBuilder().addComponents(
        btn('create_cats', 'Créer les catégories pour moi', ButtonStyle.Success),
        btn('next2', 'Continuer', ButtonStyle.Primary, !state.categories.open),
        btn('back1', 'Retour'),
      ),
    ],
  };
}

function stepPanel(state) {
  const m = new ChannelSelectMenuBuilder().setCustomId('setup:panel').setPlaceholder('Salon du panel (facultatif)').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
  if (state.panelChannel) m.setDefaultChannels([state.panelChannel]);
  return {
    embeds: [embed(3, 'Panel', 'Un message avec un bouton « Ouvrir un ticket », dans le salon de ton choix. Les membres peuvent aussi toujours écrire au bot en message privé.\n\nChoisis un salon, ou termine sans panel.')],
    components: [
      new ActionRowBuilder().addComponents(m),
      new ActionRowBuilder().addComponents(btn('finish', 'Terminer', ButtonStyle.Success), btn('back2', 'Retour')),
    ],
  };
}

// Creates the three stage categories, hidden from @everyone, visible to the bot and the staff roles
async function createCategories(client, guildId, roleIds) {
  const guild = await client.guilds.fetch(guildId);
  const view = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory];
  const overwrites = [
    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: client.user.id, allow: [...view, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.SendMessages] },
    ...roleIds.map(id => ({ id, allow: view })),
  ];
  const out = {};
  for (const [k, name] of Object.entries(CATEGORY_NAMES)) {
    const c = await guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites, reason: 'Assistant /setup' });
    out[k] = c.id;
  }
  return out;
}

// Saves the settings and posts the panel. Returns { error } or { ok, panel: { channelId, messageId } | null }
async function applySetup(client, guildId, user, state) {
  const db = getTenantDb(guildId);
  const { applyConfigUpdates } = require('../web/routes/config');
  const fakeReq = { session: { user: { id: user.id, username: user.username } }, guildDb: db, guildId, app: { locals: { client } } };
  const r = await applyConfigUpdates(fakeReq, {
    supportRoleIds: state.support, chiefRoleIds: state.chief,
    ticketCategoryId: state.categories.open || null,
    waitingCategoryId: state.categories.waiting || null,
    inProgressCategoryId: state.categories.progress || null,
  }, { source: 'setup' });
  if (r.error) return { error: r.error };

  let panel = null;
  if (state.panelChannel) {
    const { fetchGuildChannel } = require('../utils/discordGuard');
    const ch = await fetchGuildChannel(client, guildId, state.panelChannel);
    if (!ch?.isTextBased?.()) return { error: 'Salon du panel introuvable' };
    const ins = await db("INSERT INTO ticket_panels (name, title, description, color, footer_text, image_url) VALUES ('Panel (assistant /setup)', 'Support', ?, '#2f6feb', NULL, NULL)",
      ['Besoin d\'aide ? Clique sur le bouton : la conversation continue en message privé avec le bot.']);
    const panelId = ins.insertId;
    await db("INSERT INTO panel_buttons (panel_id, label, emoji, style, subject, position) VALUES (?, 'Ouvrir un ticket', '📩', 'primary', NULL, 0)", [panelId]);
    const [row] = await db('SELECT * FROM ticket_panels WHERE id = ?', [panelId]);
    const buttons = await db('SELECT * FROM panel_buttons WHERE panel_id = ? ORDER BY position', [panelId]);
    const panels = require('../web/routes/panels');
    const msg = await ch.send({ embeds: [await panels.buildDiscordEmbed(row)], components: panels.buildDiscordComponents(buttons) });
    await db('UPDATE ticket_panels SET channel_id = ?, message_id = ? WHERE id = ?', [ch.id, msg.id, panelId]);
    panel = { channelId: ch.id, messageId: msg.id };
  }
  const { logAudit } = require('../utils/gradePermissions');
  await logAudit(user.id, user.username, 'setup_wizard', 'guild', guildId, { roles: state.support.length + state.chief.length, panel: !!panel, createdCategories: !!state.createdCategories }, db);
  return { ok: true, panel };
}

function summary(state, result) {
  const { config } = require('../utils/config');
  const lines = [
    `**Rôles support** : ${state.support.map(id => `<@&${id}>`).join(', ')}`,
    state.chief.length ? `**Chef support** : ${state.chief.map(id => `<@&${id}>`).join(', ')}` : null,
    `**Catégories** : ${['open', 'waiting', 'progress'].map(k => (state.categories[k] ? `<#${state.categories[k]}>` : '—')).join(' · ')}`,
    result.panel ? `**Panel** : publié dans <#${result.panel.channelId}>` : '**Panel** : aucun (les membres écrivent au bot en MP)',
    '',
    'Le support est prêt : un message privé au bot ouvre un ticket.',
    config.webServerBaseUrl ? `La suite (sujets, messages, grades, FAQ) se règle sur le dashboard : ${config.webServerBaseUrl}` : null,
  ].filter(l => l !== null);
  return { embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Configuration terminée').setDescription(lines.join('\n'))], components: [] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Assistant de configuration : rôles du staff, catégories et panel (fondateurs)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    if (!(await isFounder(client, db, interaction.user.id))) {
      return interaction.reply({ content: '❌ Réservé aux fondateurs du serveur.', flags: MessageFlags.Ephemeral });
    }
    const [cfg] = await db('SELECT support_role_ids, chief_role_ids, ticket_category_id, waiting_category_id, in_progress_category_id FROM guild_config WHERE id = 1');
    const state = {
      support: parseJsonField(cfg?.support_role_ids, []), chief: parseJsonField(cfg?.chief_role_ids, []),
      categories: { open: cfg?.ticket_category_id || null, waiting: cfg?.waiting_category_id || null, progress: cfg?.in_progress_category_id || null },
      panelChannel: null,
    };
    await saveState(interaction.guildId, interaction.user.id, state);
    return interaction.reply({ ...stepRoles(state), flags: MessageFlags.Ephemeral });
  },

  // Buttons and select menus of the wizard (customId « setup:… »)
  async handleComponent(client, interaction) {
    const { guildId, user } = interaction;
    const db = getTenantDb(guildId);
    if (!(await isFounder(client, db, user.id))) return interaction.reply({ content: '❌ Réservé aux fondateurs du serveur.', flags: MessageFlags.Ephemeral });
    const state = await loadState(guildId, user.id);
    if (!state) return interaction.update({ content: '⌛ Assistant expiré : relance `/setup`.', embeds: [], components: [] });
    const id = interaction.customId.slice('setup:'.length);
    const values = interaction.values || [];

    if (id === 'support' || id === 'chief') { state[id] = values; await saveState(guildId, user.id, state); return interaction.update(stepRoles(state)); }
    if (id.startsWith('cat_')) {
      state.categories[{ cat_open: 'open', cat_waiting: 'waiting', cat_progress: 'progress' }[id]] = values[0] || null;
      await saveState(guildId, user.id, state); return interaction.update(stepCategories(state));
    }
    if (id === 'panel') { state.panelChannel = values[0] || null; await saveState(guildId, user.id, state); return interaction.update(stepPanel(state)); }
    if (id === 'cancel') { await redis().del(key(guildId, user.id)); return interaction.update({ content: 'Assistant annulé : rien n\'a été modifié.', embeds: [], components: [] }); }
    if (id === 'next1') return interaction.update(stepCategories(state));
    if (id === 'back1') return interaction.update(stepRoles(state));
    if (id === 'next2') return interaction.update(stepPanel(state));
    if (id === 'back2') return interaction.update(stepCategories(state));
    if (id === 'create_cats') {
      await interaction.deferUpdate();
      try {
        state.categories = await createCategories(client, guildId, [...new Set([...state.support, ...state.chief])]);
        state.createdCategories = true;
      } catch (err) {
        return interaction.editReply({ ...stepCategories(state), content: `❌ Création impossible (le bot a-t-il « Gérer les salons » ?) : ${err.message}` });
      }
      await saveState(guildId, user.id, state);
      return interaction.editReply({ ...stepPanel(state), content: '✅ Catégories créées.' });
    }
    if (id === 'finish') {
      await interaction.deferUpdate();
      const result = await applySetup(client, guildId, user, state).catch(err => ({ error: err.message }));
      if (result.error) return interaction.editReply({ ...stepPanel(state), content: `❌ ${result.error}` });
      await redis().del(key(guildId, user.id));
      return interaction.editReply({ content: '', ...summary(state, result) });
    }
    return interaction.deferUpdate();
  },

  applySetup, createCategories, isFounder,
};
