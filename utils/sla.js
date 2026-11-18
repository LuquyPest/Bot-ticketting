// Per-stage service level: each stage (Ouvert / En attente / En cours, and the custom statuses
// of the space) may have a maximum time in hours (0 = none). Time counts from the last stage
// change. cfg.stageSla ({ stage: hours }, utils/stages.js withStageSla) covers every stage;
// without it, the three guild_config columns.
const SLA_COLUMN = { open: 'sla_open_hours', waiting: 'sla_waiting_hours', in_progress: 'sla_in_progress_hours' };
const WARNING_RATIO = 0.75;

// A category (subject) deadline replaces the stage's for every stage that has one (v4.2,
// cfg.subjectSla, inherited by the sub-categories); a stage without deadline stays without
function slaHours(cfg, stage, subject = null) {
  const base = cfg?.stageSla ? Number(cfg.stageSla[stage || 'open']) || 0 : Number(cfg?.[SLA_COLUMN[stage || 'open']]) || 0;
  if (!base || !subject || !cfg?.subjectSla) return base;
  return require('./subjectTree').subjectSlaHours(cfg.subjectSla, subject) || base;
}

// { hours, since, dueAt, elapsedMinutes, state: 'ok' | 'warning' | 'breached' } or null (no SLA / closed)
function slaStatus(ticket, cfg, now = Date.now()) {
  if (!ticket || ticket.status !== 'open') return null;
  const hours = slaHours(cfg, ticket.stage, ticket.subject);
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
  const stages = cfg?.stageSla ? Object.keys(cfg.stageSla) : Object.keys(SLA_COLUMN);
  const elapsed = 'TIMESTAMPDIFF(MINUTE, COALESCE(stage_changed_at, created_at), NOW())';
  // Subjects whose deadline differs from the stage's (own or inherited from their category)
  const special = Object.keys(cfg?.subjectSla || {}).length ? (cfg.subjects || []) : [];
  for (const stage of stages) {
    const h = slaHours(cfg, stage);
    if (!h) continue;
    const own = special.filter(s => slaHours(cfg, stage, s) !== h);
    for (const s of own) {
      parts.push(`(stage = ? AND subject = ? AND ${elapsed} >= ?)`);
      params.push(stage, s, slaHours(cfg, stage, s) * 60);
    }
    parts.push(`(stage = ?${own.length ? ' AND (subject IS NULL OR subject NOT IN (?))' : ''} AND ${elapsed} >= ?)`);
    params.push(stage, ...(own.length ? [own] : []), h * 60);
  }
  return parts.length
    ? { sql: `(status = 'open' AND (${parts.join(' OR ')}))`, params }
    : { sql: '0 = 1', params: [] };
}

module.exports = { slaStatus, slaHours, breachedSql };
