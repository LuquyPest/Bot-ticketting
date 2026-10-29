// Discord changes that can break the bot's setup (its roles edited, a channel or role deleted):
// the server's health is checked again shortly after (utils/guildHealth.js).
const { scheduleHealthCheck } = require('../utils/guildHealth');

const WATCHED = new Set(['GUILD_ROLE_UPDATE', 'GUILD_ROLE_DELETE', 'CHANNEL_DELETE', 'GUILD_MEMBER_UPDATE']);

module.exports = {
  name: 'raw',
  async execute(client, packet) {
    if (!WATCHED.has(packet.t) || !packet.d?.guild_id) return;
    if (packet.t === 'GUILD_MEMBER_UPDATE' && packet.d.user?.id !== client.user?.id) return;
    scheduleHealthCheck(client, packet.d.guild_id);
  },
};
