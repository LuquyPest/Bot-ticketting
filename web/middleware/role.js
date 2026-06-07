const { query } = require('../../utils/db');

// Fix #3 : le rôle est relu en base à chaque requête — révocation immédiate sans attendre l'expiration du cookie
module.exports = function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    try {
      const [dbUser] = await query(
        'SELECT role FROM dashboard_users WHERE user_id = ?',
        [req.session.user.id]
      );
      if (!dbUser) {
        req.session.destroy(() => {});
        return res.status(401).json({ error: 'Utilisateur introuvable' });
      }
      // Synchronise la session si le rôle a changé en base
      req.session.user.role = dbUser.role;
      if (!roles.includes(dbUser.role)) {
        return res.status(403).json({ error: 'Accès refusé — rôle insuffisant' });
      }
      next();
    } catch (err) {
      console.error('requireRole error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
};
