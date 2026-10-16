const express = require('express');
const router = express.Router();
const { authenticator } = require('otplib');
const { verifyTotp, generateRecoveryCodes } = require('../../utils/totp');
const { seal } = require('../../utils/secretBox');
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
              vacation_mode, notify_assign_dm, first_login, last_login
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
        notifyAssignDm:    !!user.notify_assign_dm,
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
  const { bio, bannerColor, profilePictureUrl, vacationMode, notifyAssignDm } = req.body;

  if (bio !== undefined && bio !== null && (typeof bio !== 'string' || bio.length > 160))
    return res.status(400).json({ error: 'Bio trop longue (max 160 caractères)' });
  if (bannerColor !== undefined && (typeof bannerColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(bannerColor)))
    return res.status(400).json({ error: 'Couleur de bannière invalide (format #RRGGBB)' });
  if (profilePictureUrl !== undefined && profilePictureUrl !== null) {
    if (typeof profilePictureUrl !== 'string' || profilePictureUrl.length > 512)
      return res.status(400).json({ error: 'URL de photo invalide (max 512 caractères)' });
    try {
      // Discord CDN only: matches the dashboard CSP (img-src) and stops a third-party host
      // from logging the IP of every staff member who views the profile
      const parsed = new URL(profilePictureUrl);
      if (parsed.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(parsed.hostname))
        return res.status(400).json({ error: 'La photo de profil doit être une image hébergée sur Discord (cdn.discordapp.com)' });
    } catch {
      return res.status(400).json({ error: 'URL de photo de profil invalide' });
    }
  }

  const sets = [];
  const params = [];
  if (bio               !== undefined) { sets.push('bio = ?');                 params.push(bio || null); }
  if (bannerColor       !== undefined) { sets.push('banner_color = ?');        params.push(bannerColor); }
  if (profilePictureUrl !== undefined) { sets.push('profile_picture_url = ?'); params.push(profilePictureUrl || null); }
  if (vacationMode      !== undefined) { sets.push('vacation_mode = ?');       params.push(vacationMode ? 1 : 0); }
  if (notifyAssignDm    !== undefined) { sets.push('notify_assign_dm = ?');    params.push(notifyAssignDm ? 1 : 0); }

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

const codeOf = req => (typeof req.body.code === 'string' ? req.body.code : '').trim();

router.post('/2fa/enable', requireAuth, async (req, res) => {
  const code = codeOf(req);
  if (!code) return res.status(400).json({ error: 'Code requis' });

  const setup = req.session.twoFaSetup;
  if (!setup || setup.userId !== req.session.user.id)
    return res.status(400).json({ error: 'Session de configuration expirée. Recommence depuis le début.' });

  const step = verifyTotp(code, setup.secret);
  if (!step) return res.status(400).json({ error: 'Code invalide' });

  try {
    const { codes, hashes } = generateRecoveryCodes();
    await globalQuery(
      `INSERT INTO user_totp (user_id, totp_secret, totp_enabled, totp_last_step, recovery_codes) VALUES (?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE totp_secret = VALUES(totp_secret), totp_enabled = 1,
         totp_last_step = VALUES(totp_last_step), recovery_codes = VALUES(recovery_codes)`,
      [req.session.user.id, seal(setup.secret), step, JSON.stringify(hashes)]
    );
    delete req.session.twoFaSetup;
    // Shown once: only hashes are stored
    res.json({ ok: true, recoveryCodes: codes });
  } catch (err) {
    console.error('profile/2fa/enable error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const TOTP_DISABLE_MAX = 5;

// Checks a TOTP for the logged-in user (with lockout). Sends the error response and returns false on failure.
async function checkUserTotp(req, res) {
  const code = codeOf(req);
  if (!code) { res.status(400).json({ error: 'Code requis' }); return false; }

  const attempts = req.session.totpDisableAttempts || 0;
  if (attempts >= TOTP_DISABLE_MAX) {
    req.session.destroy(() => {});
    res.status(429).json({ error: 'Trop de tentatives — reconnecte-toi' });
    return false;
  }

  const [row] = await globalQuery(
    'SELECT totp_secret, totp_last_step FROM user_totp WHERE user_id = ? AND totp_enabled = 1',
    [req.session.user.id]
  );
  if (!row) { res.status(400).json({ error: '2FA non activé' }); return false; }

  const step = verifyTotp(code, row.totp_secret, row.totp_last_step);
  if (!step) {
    req.session.totpDisableAttempts = attempts + 1;
    const remaining = TOTP_DISABLE_MAX - req.session.totpDisableAttempts;
    res.status(400).json({
      error: `Code invalide — ${remaining} tentative${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}`
    });
    return false;
  }
  delete req.session.totpDisableAttempts;
  await globalQuery('UPDATE user_totp SET totp_last_step = ? WHERE user_id = ?', [step, req.session.user.id]);
  return true;
}

router.post('/2fa/disable', requireAuth, async (req, res) => {
  try {
    if (!(await checkUserTotp(req, res))) return;
    await globalQuery('DELETE FROM user_totp WHERE user_id = ?', [req.session.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('profile/2fa/disable error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/profile/2fa/recovery-codes — new set of recovery codes (invalidates the old ones)
router.post('/2fa/recovery-codes', requireAuth, async (req, res) => {
  try {
    if (!(await checkUserTotp(req, res))) return;
    const { codes, hashes } = generateRecoveryCodes();
    await globalQuery('UPDATE user_totp SET recovery_codes = ? WHERE user_id = ?', [JSON.stringify(hashes), req.session.user.id]);
    res.json({ ok: true, recoveryCodes: codes });
  } catch (err) {
    console.error('profile/2fa/recovery-codes error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
