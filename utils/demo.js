// Demonstration server: a sandbox database filled with fictitious but realistic data, to show the
// dashboard to a server waiting for approval (or to anyone). It is not a row of `guilds`, so no
// automation, scan or super-admin list ever touches it. A visitor gets a founder session limited to
// this database; actions that could reach the outside (webhooks, API keys, guest links, newsletter,
// Discord identity, import, GDPR, 2FA) are refused. Reset every night and on demand.
const { getTenantDb } = require('./tenantDb');

const DEMO_GUILD_ID = '999999999999999999';   // snowflake far in the future: never a real server
const DEMO_USER_ID = '999999999999999998';
const DEMO_NAME = 'Serveur de démonstration';

// [method, path prefix, fields of a PATCH /api/config that are blocked]
const BLOCKED = [
  ['*', '/api/api-keys'], ['*', '/api/guest-invites'], ['*', '/api/newsletter'], ['*', '/api/config/bot-identity'],
  ['*', '/api/config/import'], ['*', '/api/members'], ['*', '/api/push'], ['*', '/api/profile'], ['*', '/api/sessions'],
  ['*', '/api/auth/select-guild'], ['*', '/api/tickets/open'],
];
// Adding a participant or contacting a member takes any Discord ID: never from the demo (see
// sendToMember); the voice channel would be created on Discord
const BLOCKED_RE = [/^\/api\/tickets\/\d+\/participants(\/|$)/, /^\/api\/tickets\/\d+\/voice$/];
const BLOCKED_CONFIG_FIELDS = ['webhookUrl', 'webhookSecret', 'webhooksEnabled', 'webhookEvents', 'ipAllowlist', 'require2fa', 'apiKeysEnabled'];

const isDemoSession = session => !!session?.user?.demo;

// Express middleware: in a demo session, mutations that could leave the sandbox are refused
function demoGuard(req, res, next) {
  if (!isDemoSession(req.session) || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const path = req.originalUrl.split('?')[0];
  if (BLOCKED.some(([, prefix]) => path === prefix || path.startsWith(`${prefix}/`)) || BLOCKED_RE.some(re => re.test(path))) {
    return res.status(403).json({ error: 'Indisponible dans la démonstration', demo: true });
  }
  if (path === '/api/config' && BLOCKED_CONFIG_FIELDS.some(f => req.body?.[f] !== undefined)) {
    for (const f of BLOCKED_CONFIG_FIELDS) delete req.body[f]; // the rest of the settings can be tried
  }
  next();
}

const ago = (minutes) => new Date(Date.now() - minutes * 60000);

// Fills (or refills) the demo database. Idempotent: everything is deleted first.
async function seedDemo() {
  await require('./tenantSchema').ensureTenantSchema(DEMO_GUILD_ID);
  const db = getTenantDb(DEMO_GUILD_ID);
  await db('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const t of ['ticket_notes', 'ticket_assignees', 'ticket_participants', 'ticket_ratings', 'ticket_tag_assignments', 'ticket_tags', 'tickets',
      'dashboard_users', 'grades', 'grade_permissions', 'user_grades', 'reply_templates', 'faq_entries', 'ticket_fields', 'ticket_field_values',
      'procedures', 'ticket_procedure_checks', 'ticket_time', 'member_notes', 'member_profiles', 'incidents', 'incident_tickets', 'audit_log',
      'subject_rules', 'ticket_links', 'ticket_reminders', 'scheduled_messages', 'config_history', 'admin_stats', 'blacklist', 'transcript_snapshots']) {
      await db(`DELETE FROM ${t}`).catch(() => null); // some tables may not exist on an older schema
    }
  } finally {
    await db('SET FOREIGN_KEY_CHECKS = 1');
  }
  const subjects = ['Paiement', 'Compte', 'Bug en jeu', 'Signalement', 'Autre'];
  await db(`INSERT INTO guild_config (id, ticket_subjects, welcome_message, sla_open_hours, sla_waiting_hours, sla_in_progress_hours, internal_notes_enabled, faq_enabled, monthly_goals_enabled)
            VALUES (1, ?, ?, 4, 48, 24, 1, 1, 1)
            ON DUPLICATE KEY UPDATE ticket_subjects = VALUES(ticket_subjects), welcome_message = VALUES(welcome_message), sla_open_hours = 4, sla_waiting_hours = 48, sla_in_progress_hours = 24`,
    [JSON.stringify(subjects), 'Bienvenue sur le support ! Un membre de l\'équipe te répond au plus vite.']);

  // Staff: the visitor (founder) and fictitious colleagues
  const staff = [[DEMO_USER_ID, 'Visiteur démo', 'fondateur', 'available'], ['999999999999999901', 'Léa', 'support', 'available'],
    ['999999999999999902', 'Hugo', 'support', 'busy'], ['999999999999999903', 'Inès', 'support', 'away']];
  for (const [id, name, role, availability] of staff) {
    await db('INSERT INTO dashboard_users (user_id, username, role, availability) VALUES (?, ?, ?, ?)', [id, name, role, availability]).catch(() =>
      db('INSERT INTO dashboard_users (user_id, username, role) VALUES (?, ?, ?)', [id, name, role]));
  }
  const gChief = (await db("INSERT INTO grades (name, color) VALUES ('Chef support', '#e67e22')")).insertId;
  const gSupport = (await db("INSERT INTO grades (name, color, parent_id) VALUES ('Support', '#3498db', ?)", [gChief])).insertId;
  for (const p of ['view_tickets', 'reply_ticket', 'claim_ticket', 'close_ticket', 'view_transcripts']) await db('INSERT INTO grade_permissions VALUES (?, ?)', [gSupport, p]);
  for (const p of ['view_tickets', 'reply_ticket', 'claim_ticket', 'close_ticket', 'view_transcripts', 'manage_participants', 'view_audit', 'manage_settings']) await db('INSERT INTO grade_permissions VALUES (?, ?)', [gChief, p]);
  await db('INSERT INTO user_grades (user_id, grade_id, assigned_by_id, assigned_by_tag) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)',
    ['999999999999999901', gChief, DEMO_USER_ID, 'Visiteur démo', '999999999999999902', gSupport, DEMO_USER_ID, 'Visiteur démo', '999999999999999903', gSupport, DEMO_USER_ID, 'Visiteur démo']);

  const tags = {};
  for (const [name, color] of [['Remboursement', '#e74c3c'], ['VIP', '#f1c40f'], ['Bug', '#9b59b6'], ['En attente du membre', '#95a5a6']]) {
    tags[name] = (await db('INSERT INTO ticket_tags (name, color) VALUES (?, ?)', [name, color])).insertId;
  }

  // Tickets: [member, subject, status, stage, priority, minutes ago, assignee, conversation [source, text, minutes ago]]
  const members = ['Nora_77', 'Kev1n', 'Mathis.D', 'Sasha', 'Zoé_Pixel', 'Yanis', 'Camille R.', 'Théo42', 'Lina', 'Bastien'];
  const conv = {
    Paiement: [['user', 'Bonjour, j\'ai payé mon abonnement hier mais il n\'apparaît pas sur mon compte.'], ['reply', 'Bonjour ! Peux-tu m\'envoyer la référence de ta commande ?'], ['user', 'Oui : CMD-48213']],
    Compte: [['user', 'Je n\'arrive plus à me connecter, on me dit que mon mot de passe est faux.'], ['reply', 'Je viens de t\'envoyer un lien de réinitialisation, dis-moi si ça fonctionne.']],
    'Bug en jeu': [['user', 'Le jeu plante quand j\'ouvre l\'inventaire depuis la mise à jour.'], ['web', 'Reproduit sur PC, remonté à l\'équipe technique.'], ['reply', 'Merci, le bug est connu et un correctif arrive cette semaine.']],
    Signalement: [['user', 'Un joueur m\'insulte en privé depuis plusieurs jours, j\'ai des captures.'], ['reply', 'Merci de nous prévenir. Envoie-nous les captures ici, nous allons agir.']],
    Autre: [['user', 'Est-ce que vous recrutez des modérateurs ?'], ['reply', 'Oui ! Les candidatures ouvrent le 1er du mois prochain.']],
  };
  const tickets = [];
  for (let i = 0; i < 24; i++) {
    const subject = subjects[i % subjects.length];
    const open = i < 9;
    const stage = open ? ['open', 'in_progress', 'waiting'][i % 3] : 'open';
    const created = 60 * (i + 1) * (open ? 3 : 20);
    const member = members[i % members.length];
    const memberId = `9999999999999990${String(10 + (i % members.length)).padStart(2, '0')}`;
    const { insertId } = await db(
      `INSERT INTO tickets (channel_id, owner_id, owner_tag, subject, status, stage, priority, created_at, last_message_at, stage_changed_at, closed_at, closed_by_tag, closed_by_id, first_response_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`demo-${i}`, memberId, member, subject, open ? 'open' : 'closed', stage, i % 7 === 0 ? 'urgent' : i % 3 === 0 ? 'low' : 'normal',
        ago(created), ago(Math.max(5, created - 40)), ago(Math.max(10, created - 30)), open ? null : ago(created - 120),
        open ? null : staff[1 + (i % 3)][1], open ? null : staff[1 + (i % 3)][0], ago(created - 25)]);
    tickets.push({ id: insertId, subject, open, created, memberId, member });
    const agent = staff[1 + (i % 3)];
    if (i % 4 !== 3) await db('INSERT INTO ticket_assignees (ticket_id, user_id, assigned_by_id) VALUES (?, ?, ?)', [insertId, agent[0], DEMO_USER_ID]);
    let step = 0;
    for (const [source, text] of conv[subject]) {
      const author = source === 'user' ? [memberId, member] : [agent[0], agent[1]];
      await db('INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [insertId, author[0], author[1], text, source, ago(created - 20 * step++)]);
    }
    if (subject === 'Paiement') await db('INSERT INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (?, ?)', [insertId, tags.Remboursement]);
    if (subject === 'Bug en jeu') await db('INSERT INTO ticket_tag_assignments (ticket_id, tag_id) VALUES (?, ?)', [insertId, tags.Bug]);
    if (!open) await db('INSERT INTO ticket_ratings (ticket_id, owner_id, closed_by_id, rating, comment, rated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [insertId, memberId, agent[0], [5, 4, 5, 3, 5, 2][i % 6], i % 3 === 0 ? 'Réponse rapide, merci !' : null, ago(created - 150)]);
    await db("INSERT INTO ticket_time (ticket_id, user_id, user_tag, source, started_at, ended_at, seconds) VALUES (?, ?, ?, 'timer', ?, ?, ?)",
      [insertId, agent[0], agent[1], ago(created - 30), ago(created - 45), 300 + (i * 137) % 1800]).catch(() => null);
  }

  // Team tools filled in so every page shows something
  await db("INSERT INTO reply_templates (name, content, scope, subject, created_by_id, created_by_tag) VALUES (?, ?, 'shared', 'Paiement', ?, 'Léa'), (?, ?, 'shared', NULL, ?, 'Hugo')",
    ['Paiement reçu', 'Bonjour {{username}}, ton paiement est bien arrivé, ton abonnement est actif. Bonne journée !', '999999999999999901',
      'Clôture', 'Ton problème est réglé ? N\'hésite pas à revenir vers nous si besoin.', '999999999999999902']).catch(() => null);
  await db("INSERT INTO faq_entries (question, answer, keywords) VALUES ('Comment réinitialiser mon mot de passe ?', 'Va dans Réglages → Sécurité → « Mot de passe oublié ».', 'mot de passe, connexion'), ('Quand sont versés les remboursements ?', 'Sous 5 à 7 jours ouvrés après validation.', 'remboursement')").catch(() => null);
  await db("INSERT INTO ticket_fields (label, type, required, subject, position, var_name) VALUES ('N° de commande', 'text', 1, 'Paiement', 0, 'commande')").catch(() => null);
  await db("INSERT INTO procedures (title, subject, steps) VALUES (?, 'Paiement', ?)",
    ['Vérification d\'un paiement', JSON.stringify([{ id: 'd1000001', text: 'Demander la référence de commande' }, { id: 'd1000002', text: 'Vérifier le paiement sur le tableau de bord' }, { id: 'd1000003', text: 'Activer l\'abonnement' }])]).catch(() => null);
  const vip = tickets[0];
  await db('INSERT INTO member_profiles (member_id, labels) VALUES (?, ?)', [vip.memberId, JSON.stringify(['VIP'])]).catch(() => null);
  await db('INSERT INTO member_notes (member_id, author_id, author_tag, content, pinned) VALUES (?, ?, ?, ?, 1)', [vip.memberId, '999999999999999901', 'Léa', 'Client fidèle depuis 2 ans, déjà remboursé une fois en mars.']).catch(() => null);
  return { tickets: tickets.length };
}

// Founder session limited to the demo database
function demoUser() {
  return { id: DEMO_USER_ID, username: 'Visiteur démo', avatar: null, role: 'fondateur', demo: true };
}

module.exports = { DEMO_GUILD_ID, DEMO_USER_ID, DEMO_NAME, seedDemo, demoGuard, demoUser, isDemoSession };
