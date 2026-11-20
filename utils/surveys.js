// Satisfaction survey (v5.6, conception/v5.md §3.11): at the closing — or after a delay — the
// requester gets the survey: the built-in one (rating, comment, up to 5 more questions, on a page
// /enquete#<space>.<token> that works for Discord, e-mail and web requesters; Discord keeps its
// rating buttons) or a link to an external survey. Response rate in the reports.
// v7: standard questions NPS (0 to 10, « would you recommend us? », score = % promoters 9–10 −
// % detractors 0–6) and CES (1 to 7, « it was easy to get my request solved », average).
const crypto = require('crypto');
const { parseJsonField } = require('./jsonField');

const MODES = ['builtin', 'external'];
const QTYPES = ['rating', 'yesno', 'text', 'nps', 'ces'];
const LINK_DAYS = 30;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const base = () => String(require('./config').config.webServerBaseUrl || '').replace(/\/$/, '');

async function settings(db) {
  const [c] = await db('SELECT survey_delay_minutes, survey_mode, survey_external_url, survey_questions FROM guild_config WHERE id = 1').catch(() => []);
  return { delayMinutes: Number(c?.survey_delay_minutes) || 0, mode: MODES.includes(c?.survey_mode) ? c.survey_mode : 'builtin',
    externalUrl: c?.survey_external_url || '', questions: parseJsonField(c?.survey_questions, []) || [] };
}
function cleanSettings(input = {}) {
  const delay = Number(input.delayMinutes ?? 0);
  if (!Number.isInteger(delay) || delay < 0 || delay > 30 * 24 * 60) return { error: 'Délai d\'envoi : de 0 minute à 30 jours' };
  const mode = MODES.includes(input.mode) ? input.mode : 'builtin';
  let url = typeof input.externalUrl === 'string' ? input.externalUrl.trim().slice(0, 500) : '';
  if (mode === 'external') {
    try { const u = new URL(url); if (u.protocol !== 'https:') throw new Error(); } catch { return { error: 'Adresse de l\'enquête externe : https://…' }; }
  } else url = url || '';
  const raw = Array.isArray(input.questions) ? input.questions : [];
  if (raw.length > 5) return { error: '5 questions au plus' };
  const questions = [];
  for (const [i, q] of raw.entries()) {
    const label = typeof q?.label === 'string' ? q.label.replace(/\s+/g, ' ').trim().slice(0, 150) : '';
    if (!label) return { error: `Question ${i + 1} : libellé requis` };
    const type = QTYPES.includes(q.type) ? q.type : 'text';
    if ((type === 'nps' || type === 'ces') && questions.some(x => x.type === type)) return { error: `Une seule question ${type.toUpperCase()} par enquête` };
    questions.push({ id: `q${i + 1}`, label, type });
  }
  return { value: { delayMinutes: delay, mode, externalUrl: url, questions } };
}
async function saveSettings(db, input) {
  const r = cleanSettings(input);
  if (r.error) return r;
  const v = r.value;
  await db('UPDATE guild_config SET survey_delay_minutes = ?, survey_mode = ?, survey_external_url = ?, survey_questions = ? WHERE id = 1', [v.delayMinutes, v.mode, v.externalUrl || null, JSON.stringify(v.questions)]);
  return { ok: true };
}

// At the closing (utils/ticketManager.js): the request, sent now or by the job « surveys »
async function onClose({ db, client, guildId, ticket }) {
  const s = await settings(db);
  const token = crypto.randomBytes(24).toString('base64url');
  const ins = await db('INSERT INTO survey_requests (ticket_id, owner_id, token_hash, send_at, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL ? MINUTE, NOW() + INTERVAL ? DAY)',
    [ticket.id, ticket.owner_id, sha(token), s.delayMinutes, LINK_DAYS + Math.ceil(s.delayMinutes / 1440)]);
  if (s.delayMinutes === 0) await send({ db, client, guildId, request: { id: ins.insertId, ticket_id: ticket.id, owner_id: ticket.owner_id }, token, settings: s });
  else await db('UPDATE survey_requests SET pending_token = ? WHERE id = ?', [token, ins.insertId]); // kept until sent, then dropped
}
async function send({ db, client, guildId, request, token, settings: s }) {
  const [ticket] = await db('SELECT id, owner_id, subject FROM tickets WHERE id = ?', [request.ticket_id]);
  if (!ticket) return false;
  const { t, sendToMember } = require('./i18n');
  const { EmbedBuilder } = require('discord.js');
  const link = s.mode === 'external' ? `${s.externalUrl}${s.externalUrl.includes('?') ? '&' : '?'}ticket=${ticket.id}` : `${base()}/enquete#${guildId}.${token}`;
  const discord = /^\d{17,20}$/.test(String(ticket.owner_id));
  await sendToMember(client, ticket.owner_id, guildId, () => ({
    embeds: [new EmbedBuilder().setColor(0x6366f1).setDescription(`${t('rating.ask')}\n\n${t('survey.link', { url: link })}`)],
    // Discord keeps its rating buttons when the survey is the built-in one
    components: discord && s.mode === 'builtin' ? [require('./components').ratingButtons(ticket.id, guildId)] : [],
  }), { ticketId: ticket.id }).catch(() => null);
  await db('UPDATE survey_requests SET sent_at = NOW(), pending_token = NULL WHERE id = ?', [request.id]);
  return true;
}
async function runForGuild({ db, client, guildId }) {
  const due = await db('SELECT * FROM survey_requests WHERE sent_at IS NULL AND pending_token IS NOT NULL AND send_at <= NOW() LIMIT 200').catch(() => []);
  if (!due.length) return 0;
  const s = await settings(db);
  let n = 0;
  for (const r of due) {
    const claim = await db('UPDATE survey_requests SET sent_at = NOW() WHERE id = ? AND sent_at IS NULL', [r.id]);
    if (!claim.affectedRows) continue;
    if (await send({ db, client, guildId, request: r, token: r.pending_token, settings: s }).catch(() => false)) n++;
  }
  return n;
}
async function runSurveys(client) {
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  for (const { guild_id } of await getActiveGuilds().catch(() => [])) await runForGuild({ db: getTenantDb(guild_id), client, guildId: guild_id }).catch(() => null);
}

// ── The survey page ──
async function findByToken(link) {
  const m = /^(\d{17,20})\.([A-Za-z0-9_-]{32})$/.exec(String(link || ''));
  if (!m) return null;
  const [g] = await require('./globalDb').globalQuery("SELECT guild_id, guild_name FROM guilds WHERE guild_id = ? AND status = 'active'", [m[1]]).catch(() => []);
  if (!g) return null;
  const db = require('./tenantDb').getTenantDb(g.guild_id);
  const [r] = await db('SELECT * FROM survey_requests WHERE token_hash = ? AND answered_at IS NULL AND expires_at > NOW()', [sha(m[2])]).catch(() => []);
  if (!r) return null;
  const [ticket] = await db('SELECT id, subject, owner_id, closed_by_id, closed_by_tag FROM tickets WHERE id = ?', [r.ticket_id]);
  return ticket ? { guildId: g.guild_id, space: g.guild_name, db, request: r, ticket } : null;
}
// { rating 1-5, comment, answers: { q1: … } } → saved once
async function submit(found, input = {}) {
  const { db, request, ticket } = found;
  const s = await settings(db);
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'Choisis une note de 1 à 5' };
  const comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, 1000) : '';
  const answers = {};
  for (const q of s.questions) {
    const v = input.answers?.[q.id];
    if (v === undefined || v === null || v === '') continue;
    if (q.type === 'rating') { const n = Number(v); if (Number.isInteger(n) && n >= 1 && n <= 5) answers[q.id] = n; }
    else if (q.type === 'yesno') answers[q.id] = v === true || v === 'yes' || v === 'oui';
    else if (q.type === 'nps') { const n = Number(v); if (Number.isInteger(n) && n >= 0 && n <= 10) answers[q.id] = n; }
    else if (q.type === 'ces') { const n = Number(v); if (Number.isInteger(n) && n >= 1 && n <= 7) answers[q.id] = n; }
    else answers[q.id] = String(v).trim().slice(0, 500);
  }
  const claim = await db('UPDATE survey_requests SET answered_at = NOW() WHERE id = ? AND answered_at IS NULL', [request.id]);
  if (!claim.affectedRows) return { error: 'Cette enquête a déjà reçu une réponse', status: 410 };
  const [prev] = await db('SELECT id FROM ticket_ratings WHERE ticket_id = ? AND owner_id = ?', [ticket.id, ticket.owner_id]);
  if (!prev) await db('INSERT INTO ticket_ratings (ticket_id, owner_id, closed_by_id, rating, comment) VALUES (?, ?, ?, ?, ?)', [ticket.id, ticket.owner_id, ticket.closed_by_id || null, rating, comment || null]);
  await db('INSERT INTO survey_responses (request_id, ticket_id, rating, comment, answers) VALUES (?, ?, ?, ?, ?)', [request.id, ticket.id, rating, comment || null, JSON.stringify({ questions: s.questions, answers })]);
  await require('./audit').recordEvent(db, { actor: { id: ticket.owner_id, tag: ticket.owner_id, source: 'member' }, action: 'ticket_rating', ticketId: ticket.id, details: { rating, survey: true } });
  return { ok: true };
}
// A rating through the Discord buttons answers the survey too
async function markAnswered(db, ticketId) {
  await db('UPDATE survey_requests SET answered_at = NOW(), pending_token = NULL WHERE ticket_id = ? AND answered_at IS NULL', [ticketId]).catch(() => null);
}

// Response rate over a period, and the answers to the extra questions
async function stats(db, { days = 30, vis }) {
  const [r] = await db(`SELECT COUNT(*) AS sent, SUM(sr.answered_at IS NOT NULL) AS answered FROM survey_requests sr JOIN tickets t ON t.id = sr.ticket_id
    WHERE sr.sent_at IS NOT NULL AND sr.sent_at >= NOW() - INTERVAL ? DAY AND ${vis.sql}`, [days, ...vis.params]);
  const rows = await db(`SELECT r.answers FROM survey_responses r JOIN tickets t ON t.id = r.ticket_id WHERE r.created_at >= NOW() - INTERVAL ? DAY AND ${vis.sql} LIMIT 5000`, [days, ...vis.params]);
  const s = await settings(db);
  const questions = s.questions.map(q => {
    const vals = rows.map(x => parseJsonField(x.answers, {})?.answers?.[q.id]).filter(v => v !== undefined);
    if (q.type === 'rating') return { ...q, answers: vals.length, average: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null };
    if (q.type === 'yesno') return { ...q, answers: vals.length, yesPct: vals.length ? Math.round(vals.filter(Boolean).length / vals.length * 100) : null };
    if (q.type === 'nps') {
      const n = vals.filter(v => Number.isInteger(v));
      const pro = n.filter(v => v >= 9).length, det = n.filter(v => v <= 6).length;
      return { ...q, answers: n.length, promotersPct: n.length ? Math.round(100 * pro / n.length) : null, detractorsPct: n.length ? Math.round(100 * det / n.length) : null, score: n.length ? Math.round(100 * (pro - det) / n.length) : null };
    }
    if (q.type === 'ces') { const n = vals.filter(v => Number.isInteger(v)); return { ...q, answers: n.length, average: n.length ? Math.round(n.reduce((a, b) => a + b, 0) / n.length * 10) / 10 : null }; }
    return { ...q, answers: vals.length, last: vals.slice(-10).reverse() };
  });
  const sent = Number(r.sent || 0), answered = Number(r.answered || 0);
  return { days, sent, answered, ratePct: sent ? Math.round(answered / sent * 100) : null, questions };
}

module.exports = { MODES, QTYPES, settings, saveSettings, onClose, send, runForGuild, runSurveys, findByToken, submit, markAnswered, stats };
