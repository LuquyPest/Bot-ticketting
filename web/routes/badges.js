const express = require('express');
const router = express.Router();

// ── Badge definitions (admin CRUD) ────────────────────────────────────────────

router.get('/definitions', async (req, res) => {
  try {
    const rows = await req.guildDb('SELECT * FROM badge_definitions ORDER BY threshold ASC, name ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/definitions', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Accès refusé' });
  const { name, description, icon, color, triggerKey, threshold } = req.body;
  const VALID_TRIGGERS = [
    'first_ticket', 'tickets_10', 'tickets_50', 'tickets_100', 'tickets_500',
    'rating_5_streak', 'avg_rating_5', 'response_under_1h', 'response_under_30m',
    'custom'
  ];
  if (!name || !description || !triggerKey)
    return res.status(400).json({ error: 'Champs manquants: name, description, triggerKey' });
  if (!VALID_TRIGGERS.includes(triggerKey))
    return res.status(400).json({ error: 'triggerKey invalide' });

  try {
    const r = await req.guildDb(
      `INSERT INTO badge_definitions (name, description, icon, color, trigger_key, threshold)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, description, icon || '🏆', color || '#6366f1', triggerKey, threshold || null]
    );
    res.json({ ok: true, id: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/definitions/:id', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Accès refusé' });
  try {
    await req.guildDb('DELETE FROM badge_definitions WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── User badges ───────────────────────────────────────────────────────────────

router.get('/user/:userId', async (req, res) => {
  try {
    const rows = await req.guildDb(
      `SELECT ub.*, bd.name, bd.description, bd.icon, bd.color, bd.trigger_key
       FROM user_badges ub
       JOIN badge_definitions bd ON bd.id = ub.badge_id
       WHERE ub.user_id = ?
       ORDER BY ub.awarded_at DESC`,
      [req.params.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Check + award badges for a user (called internally after ticket events) ──

async function checkAndAwardBadges(db, userId, userTag) {
  const cfg = await db('SELECT badges_enabled FROM guild_config LIMIT 1');
  if (!cfg[0]?.badges_enabled) return;

  const defs = await db('SELECT * FROM badge_definitions WHERE active = 1');
  if (!defs.length) return;

  const [stats] = await db('SELECT * FROM admin_stats WHERE admin_id = ?', [userId]);
  const [existing] = await [await db('SELECT badge_id FROM user_badges WHERE user_id = ?', [userId])];
  const ownedIds = new Set(existing.map(r => r.badge_id));

  for (const def of defs) {
    if (ownedIds.has(def.id)) continue;
    let earned = false;

    const closed = stats?.tickets_closed || 0;
    const avg = stats?.total_ratings > 0 ? stats.total_rating_score / stats.total_ratings : 0;

    switch (def.trigger_key) {
      case 'first_ticket':         earned = closed >= 1; break;
      case 'tickets_10':           earned = closed >= 10; break;
      case 'tickets_50':           earned = closed >= 50; break;
      case 'tickets_100':          earned = closed >= 100; break;
      case 'tickets_500':          earned = closed >= 500; break;
      case 'avg_rating_5':         earned = stats?.total_ratings >= 5 && avg >= 4.8; break;
      case 'response_under_1h':    earned = stats?.total_response_count >= 10 &&
                                            (stats.total_response_seconds / stats.total_response_count) < 3600; break;
      case 'response_under_30m':   earned = stats?.total_response_count >= 10 &&
                                            (stats.total_response_seconds / stats.total_response_count) < 1800; break;
      default: break;
    }

    if (earned) {
      await db(
        'INSERT IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)',
        [userId, def.id]
      ).catch(() => null);
    }
  }
}

router.post('/check/:userId', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Accès refusé' });
  try {
    await checkAndAwardBadges(req.guildDb, req.params.userId, '');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.checkAndAwardBadges = checkAndAwardBadges;
