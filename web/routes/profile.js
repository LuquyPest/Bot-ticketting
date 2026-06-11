const express = require('express');
const router = express.Router();
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { globalQuery } = require('../../utils/globalDb');

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

// GET /api/profile/2fa — statut 2FA de l'utilisateur connecté
router.get('/2fa', requireAuth, async (req, res) => {
  try {
    const [row] = await globalQuery(
      'SELECT totp_enabled FROM user_totp WHERE user_id = ?',
      [req.session.user.id]
    );
    res.json({ enabled: !!row?.totp_enabled });
  } catch (err) {
    console.error('profile/2fa status error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/profile/2fa/setup — génère secret + QR code, stocke en session
router.post('/2fa/setup', requireAuth, async (req, res) => {
  try {
    const [row] = await globalQuery(
      'SELECT totp_enabled FROM user_totp WHERE user_id = ?',
      [req.session.user.id]
    );
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

// POST /api/profile/2fa/enable — vérifie le code et active le 2FA
router.post('/2fa/enable', requireAuth, async (req, res) => {
  const code = (req.body.code || '').replace(/\s/g, '');
  if (!code) return res.status(400).json({ error: 'Code requis' });

  const setup = req.session.twoFaSetup;
  if (!setup || setup.userId !== req.session.user.id) {
    return res.status(400).json({ error: 'Session de configuration expirée. Recommence depuis le début.' });
  }

  if (!authenticator.verify({ token: code, secret: setup.secret })) {
    return res.status(400).json({ error: 'Code invalide' });
  }

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

// POST /api/profile/2fa/disable — vérifie le code et désactive le 2FA
router.post('/2fa/disable', requireAuth, async (req, res) => {
  const code = (req.body.code || '').replace(/\s/g, '');
  if (!code) return res.status(400).json({ error: 'Code requis' });

  try {
    const [row] = await globalQuery(
      'SELECT totp_secret FROM user_totp WHERE user_id = ? AND totp_enabled = 1',
      [req.session.user.id]
    );
    if (!row) return res.status(400).json({ error: '2FA non activé' });

    if (!authenticator.verify({ token: code, secret: row.totp_secret })) {
      return res.status(400).json({ error: 'Code invalide' });
    }

    await globalQuery('DELETE FROM user_totp WHERE user_id = ?', [req.session.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('profile/2fa/disable error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
