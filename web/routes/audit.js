// Guild event journal: list with filters, metadata (labels) and analytics.
const express = require('express');
const router = express.Router();
const { ACTIONS, CATEGORIES, SOURCES } = require('../../utils/audit');
const { csvCell } = require('../../utils/csv');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.use((req, res, next) => {
  if (!req.userIsFondateur && !req.userPermissions.has('view_audit')) {
    return res.status(403).json({ error: 'Permission insuffisante' });
  }
  next();
});

// Builds WHERE from the query string; returns null + sends 400 on invalid input.
function buildFilters(req, res) {
  const q = k => (typeof req.query[k] === 'string' ? req.query[k].trim() : '');
  const where = [];
  const params = [];
  const action = q('action'), category = q('category'), source = q('source');
  const actor = q('actor'), ticket = q('ticket'), from = q('from'), to = q('to'), search = q('q');

  if (action) {
    if (!ACTIONS[action]) { res.status(400).json({ error: 'Action inconnue' }); return null; }
    where.push('action = ?'); params.push(action);
  }
  if (category) {
    const actions = Object.keys(ACTIONS).filter(a => ACTIONS[a][1] === category);
    if (!actions.length) { res.status(400).json({ error: 'Catégorie inconnue' }); return null; }
    where.push('action IN (?)'); params.push(actions);
  }
  if (source) {
    if (!SOURCES[source]) { res.status(400).json({ error: 'Source inconnue' }); return null; }
    where.push('source = ?'); params.push(source);
  }
  if (actor) {
    where.push('(actor_id = ? OR actor_tag LIKE ?)');
    params.push(actor, `%${actor.slice(0, 100).replace(/[%_]/g, '\\$&')}%`);
  }
  if (ticket) {
    const id = parseInt(ticket.replace(/^#/, ''));
    if (!id) { res.status(400).json({ error: 'Numéro de ticket invalide' }); return null; }
    where.push('ticket_id = ?'); params.push(id);
  }
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) { res.status(400).json({ error: 'Date invalide' }); return null; }
  if (from) { where.push('created_at >= ?'); params.push(from); }
  if (to)   { where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(to); }
  if (search) {
    where.push('(CAST(details AS CHAR) LIKE ? OR target_id = ?)');
    params.push(`%${search.slice(0, 100).replace(/[%_]/g, '\\$&')}%`, search.slice(0, 50));
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

const parseDetails = d => {
  if (d == null) return null;
  if (typeof d !== 'string') return d;
  try { return JSON.parse(d); } catch { return d; }
};

// GET /api/audit/meta — labels for actions, categories and sources
router.get('/meta', (req, res) => {
  res.json({
    actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, [label, category]]) => [k, { label, category }])),
    categories: CATEGORIES,
    sources: SOURCES,
  });
});

// GET /api/audit?page=&action=&category=&source=&actor=&ticket=&from=&to=&q=
router.get('/', async (req, res) => {
  const f = buildFilters(req, res);
  if (!f) return;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  try {
    const [rows, [{ total }]] = await Promise.all([
      req.guildDb(
        `SELECT id, actor_id, actor_tag, action, source, ticket_id, target_type, target_id, details, created_at
         FROM audit_log ${f.sql} ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...f.params, limit, (page - 1) * limit]
      ),
      req.guildDb(`SELECT COUNT(*) AS total FROM audit_log ${f.sql}`, f.params),
    ]);
    res.json({ rows: rows.map(r => ({ ...r, details: parseDetails(r.details) })), total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/audit/export — same filters, CSV (max 10 000 lines)
router.get('/export', async (req, res) => {
  const f = buildFilters(req, res);
  if (!f) return;
  try {
    const rows = await req.guildDb(
      `SELECT created_at, actor_tag, actor_id, source, action, ticket_id, target_type, target_id, details
       FROM audit_log ${f.sql} ORDER BY id DESC LIMIT 10000`,
      f.params
    );
    const header = ['Date', 'Acteur', 'ID acteur', 'Source', 'Action', 'Ticket', 'Cible', 'ID cible', 'Détails'];
    const lines = rows.map(r => [
      new Date(r.created_at).toISOString(), r.actor_tag, r.actor_id, SOURCES[r.source] || r.source,
      ACTIONS[r.action]?.[0] || r.action, r.ticket_id, r.target_type, r.target_id,
      typeof r.details === 'string' ? r.details : JSON.stringify(r.details),
    ].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="journal.csv"');
    res.send('﻿' + [header.join(','), ...lines].join('\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/audit/stats?days=30 (+ same filters) — analytics of the journal
router.get('/stats', async (req, res) => {
  const f = buildFilters(req, res);
  if (!f) return;
  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
  const where = `${f.sql ? f.sql + ' AND' : 'WHERE'} created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`;
  const params = [...f.params, days - 1];
  try {
    const [byDayAction, byActor, bySource, byHour, [{ total }]] = await Promise.all([
      req.guildDb(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, action, COUNT(*) AS n FROM audit_log ${where} GROUP BY day, action`, params),
      req.guildDb(`SELECT actor_id, actor_tag, source, COUNT(*) AS n FROM audit_log ${where} GROUP BY actor_id, actor_tag, source ORDER BY n DESC LIMIT 10`, params),
      req.guildDb(`SELECT source, COUNT(*) AS n FROM audit_log ${where} GROUP BY source`, params),
      req.guildDb(`SELECT HOUR(created_at) AS hour, COUNT(*) AS n FROM audit_log ${where} GROUP BY hour`, params),
      req.guildDb(`SELECT COUNT(*) AS total FROM audit_log ${where}`, params),
    ]);

    // One entry per day of the period, with a count per category
    const timeline = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      timeline.push({ day, ...Object.fromEntries(Object.keys(CATEGORIES).map(c => [c, 0])) });
    }
    const byDay = new Map(timeline.map(t => [t.day, t]));
    const actionTotals = {};
    for (const r of byDayAction) {
      const cat = ACTIONS[r.action]?.[1];
      const n = Number(r.n);
      actionTotals[r.action] = (actionTotals[r.action] || 0) + n;
      if (cat && byDay.has(r.day)) byDay.get(r.day)[cat] += n;
    }

    res.json({
      days,
      total: Number(total),
      timeline,
      actions: Object.entries(actionTotals).map(([action, n]) => ({ action, n })).sort((a, b) => b.n - a.n),
      actors: byActor.map(r => ({ ...r, n: Number(r.n) })),
      sources: bySource.map(r => ({ source: r.source, n: Number(r.n) })),
      hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, n: Number(byHour.find(r => r.hour === h)?.n || 0) })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
