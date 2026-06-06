module.exports = function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  next();
};
