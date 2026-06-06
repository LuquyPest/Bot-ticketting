const express = require('express');
const router = express.Router();
const { query } = require('../../utils/db');

router.get('/', async (req, res) => {
  try {
    const users = await query(
      'SELECT user_id, username, avatar, role, first_login, last_login FROM dashboard_users ORDER BY last_login DESC'
    );
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['nouveau', 'support', 'fondateur'].includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }
    if (req.params.id === req.session.user.id) {
      return res.status(400).json({ error: 'Impossible de modifier son propre rôle' });
    }
    const config = require('../../config.json');
    if (req.params.id === config.webFounderId) {
      return res.status(400).json({ error: 'Impossible de modifier le rôle du fondateur principal' });
    }
    await query('UPDATE dashboard_users SET role = ? WHERE user_id = ?', [role, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
