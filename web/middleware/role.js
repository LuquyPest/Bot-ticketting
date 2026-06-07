const { query } = require('../../utils/db');
const { getUserPermissions } = require('../../utils/gradePermissions');

module.exports = function requireRole(...roles) {
  const fondateurOnly = roles.length === 1 && roles[0] === 'fondateur';

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

      req.session.user.role = dbUser.role;
      const role = dbUser.role;

      if (role === 'fondateur') {
        req.userIsFondateur = true;
        req.userPermissions = new Set(require('../../utils/gradePermissions').PERMISSIONS);
        return next();
      }

      if (fondateurOnly) {
        return res.status(403).json({ error: 'Accès réservé au fondateur' });
      }

      if (role === 'nouveau') {
        return res.status(403).json({ error: 'Accès refusé — compte en attente de validation' });
      }

      req.userIsFondateur = false;
      req.userPermissions = await getUserPermissions(req.session.user.id);
      next();
    } catch (err) {
      console.error('requireRole error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
};
