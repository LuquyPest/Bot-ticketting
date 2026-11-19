// Retention of closed tickets, per space (v5.7, conception/v5.md §3.19), set in Paramètres → Tickets:
//   - after N months closed, a ticket is anonymised (requester, subject, messages, transcripts,
//     attachments, copies, field values, survey answers are removed; dates, status, type, team,
//     assignees, costs and times stay for the statistics) or deleted with everything attached;
//   - archives: tickets closed for more than M months leave the default ticket list, still found by
//     a search or the « Archives » filter.
// Runs with the daily retention purge (utils/retention.js), at most BATCH tickets per space and run.
const MODES = ['off', 'anonymize', 'delete'];
const BATCH = 500;
const ANON = '[anonymisé]';
const ANON_ID = 'anonyme';

async function settings(db) {
  const [c] = await db('SELECT ticket_retention_mode, ticket_retention_months, ticket_archive_months FROM guild_config WHERE id = 1').catch(() => []);
  return {
    mode: MODES.includes(c?.ticket_retention_mode) ? c.ticket_retention_mode : 'off',
    months: Number(c?.ticket_retention_months) || 36,
    archiveMonths: Number(c?.ticket_archive_months) || 0,
  };
}

function clean(input, cur) {
  const i = input && typeof input === 'object' ? input : {};
  const v = { ...cur };
  if (i.mode !== undefined) {
    if (!MODES.includes(i.mode)) return { error: 'Mode de rétention inconnu' };
    v.mode = i.mode;
  }
  if (i.months !== undefined) {
    const m = parseInt(i.months);
    if (!(m >= 1 && m <= 240)) return { error: 'Durée de conservation : de 1 à 240 mois' };
    v.months = m;
  }
  if (i.archiveMonths !== undefined) {
    const m = parseInt(i.archiveMonths);
    if (!(m >= 0 && m <= 240)) return { error: 'Archives : de 0 (jamais) à 240 mois' };
    v.archiveMonths = m;
  }
  return { value: v };
}

async function save(db, input) {
  const r = clean(input, await settings(db));
  if (r.error) return r;
  await db('UPDATE guild_config SET ticket_retention_mode = ?, ticket_retention_months = ?, ticket_archive_months = ? WHERE id = 1', [r.value.mode, r.value.months, r.value.archiveMonths]);
  return { settings: r.value };
}

// How many tickets the next run would treat (Paramètres: « N tickets concernés aujourd'hui »)
async function due(db, s) {
  const st = s || await settings(db);
  if (st.mode === 'off') return 0;
  const [{ n }] = await db(`SELECT COUNT(*) AS n FROM tickets WHERE status = 'closed' AND closed_at < DATE_SUB(NOW(), INTERVAL ? MONTH)${st.mode === 'anonymize' ? ' AND anonymized_at IS NULL' : ''}`, [st.months]);
  return Number(n);
}

// Optional tables (older spaces, features off): a missing one is skipped
const opt = p => p.catch(err => { if (err?.code !== 'ER_NO_SUCH_TABLE' && err?.code !== 'ER_BAD_FIELD_ERROR') throw err; return null; });

async function anonymize(db, ids) {
  await db('UPDATE tickets SET owner_id = ?, owner_tag = ?, subject = ?, anonymized_at = NOW() WHERE id IN (?)', [ANON_ID, ANON, ANON, ids]);
  await db(`UPDATE ticket_notes SET content = ?, author_id = IF(source = 'user', ?, author_id), author_tag = IF(source = 'user', ?, author_tag) WHERE ticket_id IN (?)`, [ANON, ANON_ID, ANON, ids]);
  for (const t of ['transcript_snapshots', 'email_attachments', 'email_threads', 'ticket_cc', 'ticket_field_values', 'ticket_participants']) await opt(db(`DELETE FROM ${t} WHERE ticket_id IN (?)`, [ids]));
  await opt(db('UPDATE ticket_ratings SET owner_id = ?, comment = NULL WHERE ticket_id IN (?)', [ANON_ID, ids]));
  // Survey links of the ticket closed, a survey not sent yet never leaves (#76)
  await opt(db('UPDATE survey_requests SET owner_id = ?, pending_token = NULL, expires_at = LEAST(expires_at, NOW()) WHERE ticket_id IN (?)', [ANON_ID, ids]));
  await opt(db('UPDATE survey_responses SET comment = NULL, answers = NULL WHERE ticket_id IN (?)', [ids]));
  await opt(db('UPDATE ticket_approvals SET approver_email = NULL WHERE ticket_id IN (?)', [ids]));
  await opt(db('UPDATE audit_log SET details = NULL WHERE ticket_id IN (?)', [ids]));
}

// One space: { anonymized, deleted }
async function applyRetention(db, guildId) {
  const s = await settings(db);
  const out = { anonymized: 0, deleted: 0 };
  if (s.mode === 'off') return out;
  const rows = await db(`SELECT id FROM tickets WHERE status = 'closed' AND closed_at < DATE_SUB(NOW(), INTERVAL ? MONTH)${s.mode === 'anonymize' ? ' AND anonymized_at IS NULL' : ''} ORDER BY closed_at LIMIT ?`, [s.months, BATCH]);
  const ids = rows.map(r => r.id);
  if (!ids.length) return out;
  if (s.mode === 'delete') out.deleted = (await db('DELETE FROM tickets WHERE id IN (?)', [ids])).affectedRows;
  else { await anonymize(db, ids); out.anonymized = ids.length; }
  const { recordEvent } = require('./audit');
  await recordEvent(db, { actor: { id: 'system', tag: 'Rétention' }, action: 'ticket_retention', details: { mode: s.mode, months: s.months, count: ids.length } }).catch(() => null);
  if (guildId) for (const id of ids) require('./sse').broadcast('ticket', { id, deleted: s.mode === 'delete' }, guildId);
  return out;
}

// Everything due, batch after batch (v6 « apply now », and the nightly run): at most maxBatches
// batches or maxMs, so that a huge backlog finishes over several runs instead of blocking one
async function applyAll(db, guildId, { maxBatches = 40, maxMs = 120000 } = {}) {
  const started = Date.now();
  const total = { anonymized: 0, deleted: 0, batches: 0 };
  while (total.batches < maxBatches && Date.now() - started < maxMs) {
    const r = await applyRetention(db, guildId);
    if (!r.anonymized && !r.deleted) break;
    total.anonymized += r.anonymized; total.deleted += r.deleted; total.batches++;
  }
  return { ...total, remaining: await due(db) };
}

// The archive condition for the ticket list (null when archives are off)
async function archiveSql(db) {
  const s = await settings(db);
  if (!s.archiveMonths) return null;
  return { sql: "NOT (status = 'closed' AND closed_at < DATE_SUB(NOW(), INTERVAL ? MONTH))", params: [s.archiveMonths], onlySql: "status = 'closed' AND closed_at < DATE_SUB(NOW(), INTERVAL ? MONTH)" };
}

module.exports = { MODES, BATCH, ANON, settings, save, due, applyRetention, applyAll, archiveSql };
