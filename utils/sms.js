// SMS as a notification channel (v7, conception/v7.md §3.6). The owner of the instance sets the
// gateway (Instance → SMS): Twilio, OVHcloud, or a generic HTTPS gateway (JSON { to, text }); the
// secrets are sealed and never sent back. Each staff member gives their number in their profile and
// confirms it with a code received by SMS; only a confirmed number gets messages. A space sends at
// most N SMS a day (instance setting, 200 by default); a notification SMS says the event and the
// ticket number, never the content of a confidential ticket.
const crypto = require('crypto');
const { getSetting, setSetting } = require('./instanceSettings');
const { seal, open } = require('./secretBox');

const KEY = 'sms_gateway';
const PROVIDERS = ['twilio', 'ovh', 'http'];
const PHONE_RE = /^\+[1-9]\d{6,14}$/; // E.164
const SECRET_FIELDS = ['authToken', 'appSecret', 'consumerKey', 'token'];
const DEFAULTS = { provider: null, dailyLimit: 200 };

const twilioBase = () => (process.env.TWILIO_API_URL || 'https://api.twilio.com').replace(/\/$/, '');
const ovhBase = () => (process.env.OVH_API_URL || 'https://eu.api.ovh.com/1.0').replace(/\/$/, '');

async function rawSettings() {
  const s = { ...DEFAULTS, ...(await getSetting(KEY, DEFAULTS)) };
  for (const k of SECRET_FIELDS) if (s[k]) { try { s[k] = open(s[k]); } catch { s[k] = null; } }
  return s;
}
async function settings() {
  const s = await rawSettings();
  const out = { provider: s.provider || null, dailyLimit: Number(s.dailyLimit) || 200, from: s.from || '', accountSid: s.accountSid || '', appKey: s.appKey || '', serviceName: s.serviceName || '', url: s.url || '' };
  for (const k of SECRET_FIELDS) out[`${k}Set`] = !!s[k];
  return out;
}
async function saveSettings(input = {}) {
  const cur = await getSetting(KEY, DEFAULTS);
  if (!input.provider) { await setSetting(KEY, { ...DEFAULTS, dailyLimit: cur.dailyLimit || 200 }); return { ok: true }; }
  if (!PROVIDERS.includes(input.provider)) return { error: 'Passerelle : twilio, ovh ou http' };
  const limit = input.dailyLimit === undefined ? (cur.dailyLimit || 200) : Number(input.dailyLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) return { error: 'Limite : de 1 à 10 000 SMS par jour et par espace' };
  const str = (k, max = 200) => (typeof input[k] === 'string' ? input[k].trim().slice(0, max) : '');
  const secret = k => (str(k, 500) ? seal(str(k, 500)) : (cur.provider === input.provider ? cur[k] || null : null));
  const next = { provider: input.provider, dailyLimit: limit };
  if (input.provider === 'twilio') {
    Object.assign(next, { accountSid: str('accountSid', 64), from: str('from', 32), authToken: secret('authToken') });
    if (!/^AC[0-9a-f]{32}$/i.test(next.accountSid) || !next.from || !next.authToken) return { error: 'Twilio : Account SID (AC…), jeton et numéro d\'envoi requis' };
  } else if (input.provider === 'ovh') {
    Object.assign(next, { appKey: str('appKey', 64), serviceName: str('serviceName', 64), from: str('from', 11), appSecret: secret('appSecret'), consumerKey: secret('consumerKey') });
    if (!next.appKey || !/^sms-[a-z0-9-]+$/i.test(next.serviceName) || !next.appSecret || !next.consumerKey) return { error: 'OVHcloud : clé, secret et consumer key de l\'application, et compte SMS (sms-…) requis' };
  } else {
    Object.assign(next, { url: str('url', 500), token: secret('token') });
    let u = null;
    try { u = new URL(next.url); } catch { /* invalid */ }
    if (!u || u.protocol !== 'https:') return { error: 'Passerelle HTTP : une adresse https://' };
  }
  await setSetting(KEY, next);
  return { ok: true };
}

// One SMS → { ok } or { error }
async function sendRaw(s, to, text) {
  const body = String(text).slice(0, 320);
  if (s.provider === 'twilio') {
    const r = await fetch(`${twilioBase()}/2010-04-01/Accounts/${encodeURIComponent(s.accountSid)}/Messages.json`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Basic ${Buffer.from(`${s.accountSid}:${s.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: s.from, Body: body }).toString(),
    });
    return r.ok ? { ok: true } : { error: `Twilio : réponse ${r.status}` };
  }
  if (s.provider === 'ovh') {
    const url = `${ovhBase()}/sms/${encodeURIComponent(s.serviceName)}/jobs`;
    const payload = JSON.stringify({ message: body, receivers: [to], sender: s.from || undefined, noStopClause: true, priority: 'high', charset: 'UTF-8' });
    const ts = Math.round(Date.now() / 1000).toString();
    const sig = `$1$${crypto.createHash('sha1').update([s.appSecret, s.consumerKey, 'POST', url, payload, ts].join('+')).digest('hex')}`;
    const r = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), body: payload,
      headers: { 'Content-Type': 'application/json', 'X-Ovh-Application': s.appKey, 'X-Ovh-Consumer': s.consumerKey, 'X-Ovh-Timestamp': ts, 'X-Ovh-Signature': sig } });
    return r.ok ? { ok: true } : { error: `OVHcloud : réponse ${r.status}` };
  }
  // Generic gateway: HTTPS, public address only (utils/webhookEmitter.js)
  const r = await require('./webhookEmitter').safePostJson(s.url, JSON.stringify({ to, text: body }), s.token ? { Authorization: `Bearer ${s.token}` } : {});
  return r.status >= 200 && r.status < 300 ? { ok: true } : { error: r.blocked ? 'Passerelle HTTP refusée (adresse privée ou non https)' : `Passerelle HTTP : ${r.status || 'pas de réponse'}` };
}

// Counts against the space's daily limit (Redis); guildId null = instance (test, codes)
async function underLimit(guildId, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `sms:${guildId || 'instance'}:${day}`;
  const redis = require('./redis').getRedis();
  const n = await redis.incr(key).catch(() => 0);
  if (n === 1) await redis.expire(key, 2 * 86400).catch(() => null);
  return n <= limit;
}
async function send(guildId, to, text) {
  const s = await rawSettings();
  if (!s.provider) return { error: 'Aucune passerelle SMS' };
  if (!PHONE_RE.test(String(to || ''))) return { error: 'Numéro invalide (format international, +33…)' };
  if (!(await underLimit(guildId, Number(s.dailyLimit) || 200))) return { error: 'Limite de SMS du jour atteinte' };
  try { return await sendRaw(s, to, text); } catch (err) { return { error: `SMS : ${err.message}` }; }
}

// ── Staff numbers (global accounts) ──
async function phoneOf(userId) {
  const [a] = await require('./globalDb').globalQuery('SELECT phone, phone_verified FROM accounts WHERE id = ?', [String(userId)]).catch(() => []);
  return { phone: a?.phone || null, verified: !!Number(a?.phone_verified) };
}
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
// Saves the number (unconfirmed) and sends a code, valid 10 minutes
async function startVerification(userId, phone) {
  const p = String(phone || '').replace(/[\s.-]/g, '');
  if (!PHONE_RE.test(p)) return { error: 'Numéro invalide (format international, +33…)' };
  const redis = require('./redis').getRedis();
  const tries = await redis.incr(`smscode:n:${userId}`).catch(() => 0);
  if (tries === 1) await redis.expire(`smscode:n:${userId}`, 3600).catch(() => null);
  if (tries > 5) return { error: 'Trop de codes demandés, réessaie dans une heure' };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const { globalQuery } = require('./globalDb');
  const saved = await globalQuery('UPDATE accounts SET phone = ?, phone_verified = 0 WHERE id = ?', [p, String(userId)]);
  if (!saved.affectedRows) return { error: 'Compte introuvable' };
  await redis.set(`smscode:${userId}`, JSON.stringify({ h: sha(`${p}:${code}`), tries: 0 }), 'EX', 600);
  const r = await send(null, p, `Datick : ton code de confirmation est ${code}. Il est valable 10 minutes.`);
  return r.error ? { error: r.error } : { ok: true };
}
async function confirmVerification(userId, code) {
  const redis = require('./redis').getRedis();
  const raw = await redis.get(`smscode:${userId}`).catch(() => null);
  if (!raw) return { error: 'Code expiré : demande un nouveau code' };
  const st = JSON.parse(raw);
  const { phone } = await phoneOf(userId);
  if (st.tries >= 5) { await redis.del(`smscode:${userId}`); return { error: 'Trop d\'essais : demande un nouveau code' }; }
  const ok = phone && /^\d{6}$/.test(String(code || '')) && crypto.timingSafeEqual(Buffer.from(st.h), Buffer.from(sha(`${phone}:${code}`)));
  if (!ok) { await redis.set(`smscode:${userId}`, JSON.stringify({ ...st, tries: st.tries + 1 }), 'KEEPTTL'); return { error: 'Code incorrect' }; }
  await redis.del(`smscode:${userId}`);
  await require('./globalDb').globalQuery('UPDATE accounts SET phone_verified = 1 WHERE id = ?', [String(userId)]);
  return { ok: true };
}
async function removePhone(userId) {
  await require('./globalDb').globalQuery('UPDATE accounts SET phone = NULL, phone_verified = 0 WHERE id = ?', [String(userId)]);
  return { ok: true };
}

// Notification channel (utils/notifications.js): only to a confirmed number
async function notifyUser(guildId, userId, text) {
  const { phone, verified } = await phoneOf(userId);
  if (!phone || !verified) return false;
  return !(await send(guildId, phone, text)).error;
}

module.exports = { PROVIDERS, PHONE_RE, settings, saveSettings, send, phoneOf, startVerification, confirmVerification, removePhone, notifyUser };
