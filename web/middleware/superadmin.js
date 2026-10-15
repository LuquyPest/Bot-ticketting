// Middleware: require a valid super-admin or manager session.
// Sets req.isSuperAdmin and req.saUser. SA sessions expire after SA_IDLE_MS without activity.
const SA_IDLE_MS = 30 * 60 * 1000;

module.exports = function requireSuperAdmin(req, res, next) {
  const sa = req.session?.superAdmin;
  if (!sa) {
    return res.status(401).json({ error: 'Accès super-admin requis' });
  }
  if (!sa.lastSeen || Date.now() - sa.lastSeen > SA_IDLE_MS) {
    delete req.session.superAdmin;
    return res.status(401).json({ error: 'Session super-admin expirée (inactivité) — reconnecte-toi' });
  }
  sa.lastSeen = Date.now();
  req.isSuperAdmin = sa.type === 'superadmin';
  req.saUser = sa;
  next();
};
