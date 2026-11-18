// Slack and Microsoft Teams (v5.2, conception/v5.md §3.18): team notifications posted by an
// incoming webhook of the space (channels « slack » and « teams » of utils/notifications.js), with
// simple actions:
// - Slack: « Prendre » is a real button (Slack app interactivity, requests signed with the app's
//   signing secret, web/routes/chatActions.js); the Slack user is linked once to their staff
//   account (a link opened in the dashboard). « Répondre » opens the ticket.
// - Teams: incoming webhooks cannot receive clicks, so « Prendre » and « Répondre » open the ticket
//   in the dashboard (?prendre=1 asks to take it there).
// The webhook URLs and the signing secret are secrets: sealed at rest, never sent back.
const crypto = require('crypto');
const { seal, open } = require('./secretBox');
const { CONFIDENTIAL } = require('./gradePermissions');

const KINDS = ['slack', 'teams'];
const HOSTS = {
  slack: h => h === 'hooks.slack.com',
  teams: h => /(^|\.)webhook\.office\.com$/.test(h) || /(^|\.)logic\.azure\.com$/.test(h) || /(^|\.)powerplatform\.com$/.test(h) || /(^|\.)powerautomate\.com$/.test(h),
};
const base = () => String(require('./config').config.webServerBaseUrl || '').replace(/\/$/, '');

async function rowOf(db, kind) {
  const [r] = await db('SELECT * FROM chat_integrations WHERE kind = ?', [kind]).catch(() => []);
  return r || null;
}
async function view(db, guildId) {
  const out = {};
  for (const kind of KINDS) {
    const r = await rowOf(db, kind);
    out[kind] = { configured: !!r?.webhook_url, active: !!Number(r?.active), hasSecret: !!r?.signing_secret };
  }
  out.slack.actionUrl = `${base()}/api/chat/slack/actions/${guildId}`;
  return out;
}

function checkUrl(kind, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && HOSTS[kind](u.hostname.toLowerCase()) && url.length <= 600;
}
// input: { webhookUrl?, signingSecret?, active } — an absent secret keeps the stored one, '' removes it
async function save(db, kind, input = {}) {
  if (!KINDS.includes(kind)) return { error: 'Intégration inconnue', status: 404 };
  const cur = await rowOf(db, kind);
  let url = cur?.webhook_url || null;
  if (typeof input.webhookUrl === 'string') {
    const v = input.webhookUrl.trim();
    if (v && !checkUrl(kind, v)) return { error: kind === 'slack' ? 'Adresse de webhook Slack attendue (https://hooks.slack.com/…)' : 'Adresse de webhook Teams attendue (…webhook.office.com, ou un flux Power Automate)' };
    url = v ? seal(v) : null;
  }
  let secret = cur?.signing_secret || null;
  if (kind === 'slack' && typeof input.signingSecret === 'string') {
    const v = input.signingSecret.trim();
    if (v && !/^[a-f0-9]{32}$/i.test(v)) return { error: 'Signing secret Slack : 32 caractères hexadécimaux (Basic Information → App Credentials)' };
    secret = v ? seal(v) : null;
  }
  const active = input.active === undefined ? !!Number(cur?.active) : !!input.active;
  if (active && !url) return { error: 'Colle d\'abord l\'adresse du webhook' };
  await db('INSERT INTO chat_integrations (kind, webhook_url, signing_secret, active) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE webhook_url = VALUES(webhook_url), signing_secret = VALUES(signing_secret), active = VALUES(active)',
    [kind, url, secret, active ? 1 : 0]);
  return { ok: true };
}

// ── Messages ──
function slackMessage(guildId, ticket, { title, body, canClaim }) {
  const link = base() ? `${base()}/tickets/${ticket.id}` : null;
  const actions = [];
  if (canClaim) actions.push({ type: 'button', action_id: 'datick_claim', text: { type: 'plain_text', text: 'Prendre' }, style: 'primary', value: `${guildId}:${ticket.id}` });
  if (link) actions.push({ type: 'button', action_id: 'datick_open', text: { type: 'plain_text', text: 'Répondre' }, url: link });
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    text: title,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${esc(title)}*${body ? `\n${esc(body)}` : ''}` } }, ...(actions.length ? [{ type: 'actions', elements: actions }] : [])],
  };
}
function teamsMessage(ticket, { title, body }) {
  const link = base() ? `${base()}/tickets/${ticket.id}` : null;
  return {
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
      body: [{ type: 'TextBlock', text: title, weight: 'Bolder', wrap: true }, ...(body ? [{ type: 'TextBlock', text: body, wrap: true }] : [])],
      actions: link ? [{ type: 'Action.OpenUrl', title: 'Prendre', url: `${link}?prendre=1` }, { type: 'Action.OpenUrl', title: 'Répondre', url: link }] : [],
    } }],
  };
}

// One post per event and integration. A confidential ticket says only its number.
async function post(db, guildId, kind, ticket, { title, body }) {
  const r = await rowOf(db, kind);
  if (!r?.active || !r.webhook_url) return false;
  const url = open(r.webhook_url);
  if (!url || !checkUrl(kind, url)) return false;
  const confidential = ticket.visibility_grade_id === CONFIDENTIAL;
  const msg = { title: confidential ? `Ticket #${ticket.id}` : title, body: confidential ? '' : body, canClaim: kind === 'slack' && !!r.signing_secret };
  const payload = kind === 'slack' ? slackMessage(guildId, ticket, msg) : teamsMessage(ticket, msg);
  const res = await require('./webhookEmitter').safePostJson(url, payload);
  return !!res && !res.blocked && !res.error && !res.timeout && res.status < 400;
}
async function test(db, guildId, kind) {
  const ok = await post(db, guildId, kind, { id: 0 }, { title: 'Datick est bien relié à ce canal', body: 'Les notifications choisies dans Paramètres → Notifications arriveront ici.' });
  return ok ? { ok: true } : { error: 'Envoi refusé : vérifie l\'adresse du webhook et que l\'intégration est active' };
}

// ── Slack: signed requests and linked users ──
// v0 signature: HMAC-SHA256 of « v0:<timestamp>:<raw body> », timestamp at most 5 minutes old
function verifySlack(secret, timestamp, rawBody, signature, now = Date.now()) {
  const ts = Number(timestamp);
  if (!secret || !Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300 || typeof signature !== 'string') return false;
  const expected = `v0=${crypto.createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex')}`;
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function slackSecret(db) {
  const r = await rowOf(db, 'slack');
  return r?.signing_secret ? open(r.signing_secret) : null;
}
async function linkedUser(db, team, slackUser) {
  const [r] = await db('SELECT user_id FROM chat_user_links WHERE provider = ? AND team_id = ? AND external_id = ?', ['slack', String(team), String(slackUser)]).catch(() => []);
  return r?.user_id || null;
}
// A one-time link (15 min) that the Slack user opens signed in to the dashboard
async function linkToken(guildId, team, slackUser) {
  const token = crypto.randomBytes(24).toString('base64url');
  await require('./redis').getRedis().set(`chatlink:${token}`, JSON.stringify({ guildId, team: String(team), user: String(slackUser) }), 'EX', 900);
  return token;
}
async function useLinkToken(db, guildId, token, userId) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { error: 'Lien invalide ou expiré' };
  const raw = await require('./redis').getRedis().getdel(`chatlink:${token}`); // single use
  const data = raw ? JSON.parse(raw) : null;
  if (!data || data.guildId !== guildId) return { error: 'Lien invalide ou expiré' };
  await db('INSERT INTO chat_user_links (provider, team_id, external_id, user_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)', ['slack', data.team, data.user, String(userId)]);
  return { ok: true };
}

module.exports = { KINDS, view, save, checkUrl, post, test, slackMessage, teamsMessage, verifySlack, slackSecret, linkedUser, linkToken, useLinkToken };
