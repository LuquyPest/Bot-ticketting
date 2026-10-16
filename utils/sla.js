// Per-stage service level: each stage (Ouvert / En attente / En cours) may have a maximum time
// in hours (guild_config sla_*_hours, 0 = none). Time counts from the last stage change.
const SLA_COLUMN = { open: 'sla_open_hours', waiting: 'sla_waiting_hours', in_progress: 'sla_in_progress_hours' };
const WARNING_RATIO = 0.75;

function slaHours(cfg, stage) {
  return Number(cfg?.[SLA_COLUMN[stage || 'open']]) || 0;
}

// { hours, since, dueAt, elapsedMinutes, state: 'ok' | 'warning' | 'breached' } or null (no SLA / closed)
function slaStatus(ticket, cfg, now = Date.now()) {
  if (!ticket || ticket.status !== 'open') return null;
  const hours = slaHours(cfg, ticket.stage);
  if (!hours) return null;
  const since = new Date(ticket.stage_changed_at || ticket.created_at).getTime();
  const elapsedMinutes = Math.max(0, Math.floor((now - since) / 60000));
  const limit = hours * 60;
  const state = elapsedMinutes >= limit ? 'breached' : elapsedMinutes >= limit * WARNING_RATIO ? 'warning' : 'ok';
  return { hours, since: new Date(since), dueAt: new Date(since + limit * 60000), elapsedMinutes, state };
}

// SQL condition "over its stage SLA" for the ticket list filter (alias-free tickets table).
function breachedSql(cfg) {
  const parts = [];
  const params = [];
  for (const [stage, col] of Object.entries(SLA_COLUMN)) {
    const h = Number(cfg?.[col]) || 0;
    if (!h) continue;
    parts.push(`(stage = ? AND TIMESTAMPDIFF(MINUTE, COALESCE(stage_changed_at, created_at), NOW()) >= ?)`);
    params.push(stage, h * 60);
  }
  return parts.length
    ? { sql: `(status = 'open' AND (${parts.join(' OR ')}))`, params }
    : { sql: '0 = 1', params: [] };
}

module.exports = { slaStatus, slaHours, breachedSql, SLA_COLUMN };
