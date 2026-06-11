const express = require('express');
const router = express.Router();

// POST /api/newsletter/send — DM broadcast to all active staff
// Requires fondateur + botClient attached to req
router.post('/send', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Accès refusé' });

  const { message, subject } = req.body;
  if (!message || typeof message !== 'string' || message.length < 5 || message.length > 2000)
    return res.status(400).json({ error: 'Message requis (5-2000 caractères)' });

  const client = req.app.get('botClient');
  if (!client) return res.status(503).json({ error: 'Bot Discord non disponible' });

  try {
    const staff = await req.guildDb(
      `SELECT user_id, username FROM dashboard_users WHERE role IN ('support','fondateur') AND vacation_mode = 0`
    );

    const content = subject
      ? `📢 **${subject}**\n\n${message}`
      : `📢 **Message de la direction**\n\n${message}`;

    let sent = 0;
    let failed = 0;

    for (const member of staff) {
      try {
        const user = await client.users.fetch(member.user_id);
        await user.send(content);
        sent++;
      } catch {
        failed++;
      }
    }

    res.json({ ok: true, sent, failed, total: staff.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
