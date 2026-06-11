// Middleware: require a valid super-admin or manager session.
// Sets req.isSuperAdmin and req.saUser.
module.exports = function requireSuperAdmin(req, res, next) {
  if (!req.session?.superAdmin) {
    return res.status(401).json({ error: 'Accès super-admin requis' });
  }
  req.isSuperAdmin = req.session.superAdmin.type === 'superadmin';
  req.saUser = req.session.superAdmin;
  next();
};
