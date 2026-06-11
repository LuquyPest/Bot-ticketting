const express = require('express');
const router = express.Router();
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { globalQuery } = require('../../utils/globalDb');
const { getTenantDb } = require('../../utils/tenantDb');

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

function requireAuthWithGuild(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  if (!req.session.currentGuildId) return res.status(400).json({ error: 'Aucun serveur sélectionné' });
  req.guildDb = getTenantDb(req.session.currentGuildId);
  next();
}

// ── Profile data ─────────────────────────────────────────────────────────────

// GET /api/profile — profil complet avec stats
router.get('/', requireAuthWithGuild, async (req, res) => {
  const userId = req.session.user.id;
  const db = req.guildDb;

  try {
    const [user] = await db(
      `SELECT user_id, username, avatar, role, bio, banner_color, profile_picture_url,
              vacation_mode, first_login, last_login
       FROM dashboard_users WHERE user_id = ?`,
      [userId]
    );
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const [stats] = await db('SELECT * FROM admin_stats WHERE admin_id = ?', [userId]);

    const [[{ thisMonth }], [{ lastMonth }], [{ avgRating, ratingCount }]] = await Promise.all([
      db(`SELECT COUNT(DISTINCT ticket_id) as thisMonth FROM ticket_notes
          WHERE author_id = ? AND source != 'user'
          AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`, [userId]),
      db(`SELECT COUNT(DISTINCT ticket_id) as lastMonth FROM ticket_notes
          WHERE author_id = ? AND source != 'user'
          AND created_at >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-01')
          AND created_at < DATE_FORMAT(NOW(), '%Y-%m-01')`, [userId]),
      db(`SELECT ROUND(AVG(rating), 1) as avgRating, COUNT(*) as ratingCount
          FROM ticket_ratings WHERE closed_by_id = ?`, [userId]),
    ]);

    const [monthlyRanks, [{ totalStaff }]] = await Promise.all([
      db(`SELECT author_id, COUNT(DISTINCT ticket_id) as cnt FROM ticket_notes
          WHERE source != 'user' AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
          GROUP BY author_id ORDER BY cnt DESC`),
      db(`SELECT COUNT(*) as totalStaff FROM dashboard_users WHERE role IN ('support','fondateur')`),
    ]);

    const rankIdx = monthlyRanks.findIndex(r => r.author_id === userId);
    const rank = rankIdx >= 0 ? rankIdx + 1 : null;

    const [heatmap, recentTickets] = await Promise.all([
      db(`SELECT DATE(created_at) as day, COUNT(*) as cnt
          FROM ticket_notes WHERE author_id = ? AND source != 'user'
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL 55 DAY)
          GROUP BY DATE(created_at)`, [userId]),
      db(`SELECT t.id, t.subject, t.status, t.priority, t.owner_tag,
                 t.created_at, t.closed_at, MAX(n.created_at) as last_note_at
          FROM tickets t
          JOIN ticket_notes n ON n.ticket_id = t.id
          WHERE n.author_id = ? AND n.source != 'user'
          GROUP BY t.id ORDER BY last_note_at DESC LIMIT 5`, [userId]),
    ]);

    res.json({
      profile: {
        userId:            user.user_id,
        username:          user.username,
        discordAvatar:     user.avatar,
        role:              user.role,
        bio:               user.bio || null,
        bannerColor:       user.banner_color || '#6366f1',
        profilePictureUrl: user.profile_picture_url || null,
        vacationMode:      !!user.vacation_mode,
        firstLogin:        user.first_login,
        lastLogin:         user.last_login,
      },
      stats: {
        thisMonth:          thisMonth  || 0,
        lastMonth:          lastMonth  || 0,
        allTimeClaimed:     stats?.tickets_claimed        || 0,
        allTimeClosed:      stats?.tickets_closed         || 0,
        avgRating:          avgRating  ? parseFloat(avgRating)  : null,
        ratingCount:        ratingCount || 0,
        avgResponseSeconds: stats?.total_response_count > 0
          ? Math.round(stats.total_response_seconds / stats.total_response_count)
          : null,
        rank,
        totalStaff,
      },
      heatmap,
      recentTickets,
    });
  } catch (err) {
    console.error('GET /profile error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/profile — mise à jour des infos de profil
router.patch('/', requireAuthWithGuild, async (req, res) => {
  const { bio, bannerColor, profilePictureUrl, vacationMode } = req.body;

  if (bio !== undefined && bio !== null && (typeof bio !== 'string' || bio.length > 160))
    return res.status(400).json({ error: 'Bio trop longue (max 160 caractères)' });
  if (bannerColor !== undefined && (typeof bannerColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(bannerColor)))
    return res.status(400).json({ error: 'Couleur de bannière invalide (format #RRGGBB)' });
  if (profilePictureUrl !== undefined && profilePictureUrl !== null &&
      (typeof profilePictureUrl !== 'string' || profilePictureUrl.length > 512))
    return res.status(400).json({ error: 'URL de photo invalide (max 512 caractères)' });

  const sets = [];
  const params = [];
  if (bio               !== undefined) { sets.push('bio = ?');                 params.push(bio || null); }
  if (bannerColor       !== undefined) { sets.push('banner_color = ?');        params.push(bannerColor); }
  if (profilePictureUrl !== undefined) { sets.push('profile_picture_url = ?'); params.push(profilePictureUrl || null); }
  if (vacationMode      !== undefined) { sets.push('vacation_mode = ?');       params.push(vacationMode ? 1 : 0); }

  if (!sets.length) return res.json({ ok: true });

  try {
    params.push(req.session.user.id);
    await req.guildDb(`UPDATE dashboard_users SET ${sets.join(', ')} WHERE user_id = ?`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /profile error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── 2FA routes ────────────────────────────────────────────────────────────────

router.get('/2fa', requireAuth, async (req, res) => {
  try {
    const [row] = await globalQuery('SELECT totp_enabled FROM user_totp WHERE user_id = ?', [req.session.user.id]);
    res.json({ enabled: !!row?.totp_enabled });
  } catch (err) {
    console.error('profile/2fa status error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/2fa/setup', requireAuth, async (req, res) => {
  try {
    const [row] = await globalQuery('SELECT totp_enabled FROM user_totp WHERE user_id = ?', [req.session.user.id]);
    if (row?.totp_enabled) return res.status(400).json({ error: '2FA déjà activé' });

    const secret = authenticator.generateSecret();
    const otpUri = authenticator.keyuri(req.session.user.username, 'TicketBot Dashboard', secret);
    const qrDataUrl = await QRCode.toDataURL(otpUri);

    req.session.twoFaSetup = { secret, userId: req.session.user.id };
    res.json({ qrDataUrl, secret });
  } catch (err) {
    console.error('profile/2fa/setup error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/2fa/enable', requireAuth, async (req, res) => {
  const code = (req.body.code || '').replace(/\s/g, '');
  if (!code) return res.status(400).json({ error: 'Code requis' });

  const setup = req.session.twoFaSetup;
  if (!setup || setup.userId !== req.session.user.id)
    return res.status(400).json({ error: 'Session de configuration expirée. Recommence depuis le début.' });

  if (!authenticator.verify({ token: code, secret: setup.secret }))
    return res.status(400).json({ error: 'Code invalide' });

  try {
    await globalQuery(
      `INSERT INTO user_totp (user_id, totp_secret, totp_enabled) VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE totp_secret = VALUES(totp_secret), totp_enabled = 1`,
      [req.session.user.id, setup.secret]
    );
    delete req.session.twoFaSetup;
    res.json({ ok: true });
  } catch (err) {
    console.error('profile/2fa/enable error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const TOTP_DISABLE_MAX = 5;

router.post('/2fa/disable', requireAuth, async (req, res) => {
  const code = (req.body.code || '').replace(/\s/g, '');
  if (!code) return res.status(400).json({ error: 'Code requis' });

  const attempts = req.session.totpDisableAttempts || 0;
  if (attempts >= TOTP_DISABLE_MAX) {
    req.session.destroy(() => {});
    return res.status(429).json({ error: 'Trop de tentatives — reconnecte-toi' });
  }

  try {
    const [row] = await globalQuery(
      'SELECT totp_secret FROM user_totp WHERE user_id = ? AND totp_enabled = 1',
      [req.session.user.id]
    );
    if (!row) return res.status(400).json({ error: '2FA non activé' });

    if (!authenticator.verify({ token: code, secret: row.totp_secret })) {
      req.session.totpDisableAttempts = attempts + 1;
      const remaining = TOTP_DISABLE_MAX - req.session.totpDisableAttempts;
      return res.status(400).json({
        error: `Code invalide — ${remaining} tentative${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}`
      });
    }

    delete req.session.totpDisableAttempts;
    await globalQuery('DELETE FROM user_totp WHERE user_id = ?', [req.session.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('profile/2fa/disable error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
