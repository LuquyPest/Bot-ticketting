// Middleware: the signed-in Discord account must own the instance (utils/instance.js).
// Sets req.owner = { id, username }. A demo session never does.
const { isOwner } = require('../../utils/instance');

module.exports = async function requireOwner(req, res, next) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  if (user.demo || !(await isOwner(req.app.locals.client, user.id))) {
    return res.status(403).json({ error: 'Réservé au propriétaire de l\'instance' });
  }
  req.owner = { id: user.id, username: user.username };
  next();
};
