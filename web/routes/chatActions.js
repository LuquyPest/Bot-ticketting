// Slack interactivity (utils/chatIntegrations.js), public: POST /api/chat/slack/actions/:guildId
// Mounted before the CSRF guard and the body parsers: the signature covers the raw body. Every
// request must be signed with the space's signing secret (5 minutes at most); a Slack user acts
// only once linked to a staff account, with that account's permissions and visibility.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const chat = require('../../utils/chatIntegrations');
const { allowBurst } = require('../../utils/rateLimit');

const reply = async (responseUrl, text) => {
  try {
    const u = new URL(responseUrl);
    if (u.protocol !== 'https:' || u.hostname !== 'hooks.slack.com') return;
    await require('../../utils/webhookEmitter').safePostJson(responseUrl, { response_type: 'ephemeral', replace_original: false, text });
  } catch {}
};

async function claim(db, guildId, ticketId, userId) {
  const [u] = await db("SELECT user_id, username, role FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [userId]);
  if (!u) return 'Ton compte n\'est plus dans l\'équipe de cet espace.';
  const g = require('../../utils/gradePermissions');
  if (u.role !== 'fondateur' && !(await g.getUserPermissions(u.user_id, db)).has('claim_ticket')) return 'Il te manque la permission « Prendre en charge ».';
  const [t] = await db('SELECT * FROM tickets WHERE id = ?', [ticketId]);
  if (!t || !(await g.canUserSeeTicket(db, u.user_id, t).catch(() => false))) return `Ticket #${ticketId} introuvable.`;
  if (t.status !== 'open') return `Le ticket #${ticketId} est déjà fermé.`;
  const me = { id: u.user_id, username: u.username, tag: u.username };
  const tm = require('../../utils/ticketManager').createManager(db, require('../../utils/notifications').client(), guildId);
  const added = await tm.addAssignee(t.id, me, { ...me, source: 'slack' });
  return added ? `✅ Tu as pris le ticket #${t.id}.` : `Tu es déjà sur le ticket #${t.id}.`;
}

router.post('/slack/actions/:guildId', async (req, res, next) => {
  const ip = crypto.createHash('sha256').update(String(req.ip)).digest('hex').slice(0, 24);
  if (!(await allowBurst(`chatip:${ip}`, 120, 60 * 1000))) return res.status(429).json({ error: 'Trop de requêtes' });
  next();
}, express.raw({ type: '*/*', limit: '200kb' }), async (req, res) => {
  const { guildId } = req.params;
  if (!/^\d{17,20}$/.test(guildId)) return res.status(404).end();
  const [space] = await require('../../utils/globalDb').globalQuery('SELECT guild_id FROM guilds WHERE guild_id = ?', [guildId]).catch(() => []);
  if (!space) return res.status(404).end();
  const db = require('../../utils/tenantDb').getTenantDb(guildId);
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const secret = await chat.slackSecret(db).catch(() => null);
  if (!chat.verifySlack(secret, req.get('x-slack-request-timestamp'), raw, req.get('x-slack-signature'))) return res.status(401).json({ error: 'Signature invalide' });
  let payload;
  try { payload = JSON.parse(new URLSearchParams(raw).get('payload') || '{}'); } catch { return res.status(400).end(); }
  res.status(200).end(); // Slack wants an answer within 3 seconds; the result follows by response_url
  const action = (payload.actions || [])[0];
  if (payload.type !== 'block_actions' || action?.action_id !== 'datick_claim') return;
  const [g, id] = String(action.value || '').split(':');
  if (g !== guildId || !/^\d{1,9}$/.test(id || '')) return;
  const team = payload.team?.id || payload.user?.team_id, slackUser = payload.user?.id;
  if (!team || !slackUser) return;
  try {
    const userId = await chat.linkedUser(db, team, slackUser);
    if (!userId) {
      const token = await chat.linkToken(guildId, team, slackUser);
      const base = String(require('../../utils/config').config.webServerBaseUrl || '').replace(/\/$/, '');
      return reply(payload.response_url, `Relie d'abord ton compte Slack à ton compte Datick (une seule fois, lien valable 15 minutes) : ${base}/profile?slack=${token}`);
    }
    await reply(payload.response_url, await claim(db, guildId, Number(id), userId));
  } catch (err) {
    console.error('slack: action', guildId, err.message);
    await reply(payload.response_url, 'Action impossible pour le moment.');
  }
});

module.exports = router;
