// Record of processing activities (GDPR, article 30), generated for a space (v8, conception/v8.md
// §3.7): what Datick really holds there, according to what is turned on — e-mail, Discord, chat,
// SMS, CRM, recordings, inventory… —, the purposes, the recipients (the third-party services
// connected), the retention periods (the space's and the instance's rules) and the security
// measures. The founder completes the controller, the DPO and the contact; Markdown and PDF.
const { parseJsonField } = require('./jsonField');

const FIELDS = ['controller', 'address', 'dpo', 'contact', 'notes'];
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

async function identity(db) {
  const [c] = await db('SELECT gdpr_register FROM guild_config WHERE id = 1').catch(() => []);
  return { controller: '', address: '', dpo: '', contact: '', notes: '', ...(parseJsonField(c?.gdpr_register, {}) || {}) };
}
async function saveIdentity(db, input = {}) {
  const v = Object.fromEntries(FIELDS.map(k => [k, clip(input[k], k === 'notes' ? 4000 : 300)]));
  await db('UPDATE guild_config SET gdpr_register = ? WHERE id = 1', [JSON.stringify(v)]);
  return { ok: true };
}

const count = async (db, sql, params = []) => Number((await db(sql, params).catch(() => [{ n: 0 }]))[0]?.n || 0);

// What is turned on in the space (and in the instance), as facts
async function facts(db, guildId) {
  const { globalQuery } = require('./globalDb');
  const [g] = await globalQuery('SELECT guild_name, discord FROM guilds WHERE guild_id = ?', [guildId]).catch(() => []);
  const [cfg] = await db('SELECT * FROM guild_config WHERE id = 1').catch(() => [{}]);
  const email = await count(db, 'SELECT COUNT(*) AS n FROM email_settings WHERE enabled = 1');
  const chatIntegrations = await count(db, 'SELECT COUNT(*) AS n FROM chat_integrations');
  const extensions = await count(db, 'SELECT COUNT(*) AS n FROM extensions WHERE active = 1');
  const monitoring = await count(db, 'SELECT COUNT(*) AS n FROM monitoring_sources WHERE active = 1');
  const sms = !!(await require('./sms').settings().catch(() => ({}))).provider;
  const dev = await require('./devIntegrations').settings(db, guildId).catch(() => ({}));
  const retention = await require('./ticketRetention').settings(db).catch(() => ({ mode: 'off' }));
  const { DEFAULTS } = require('./retention');
  const logs = { ...DEFAULTS, ...(require('./config').config.retention || {}) };
  return {
    space: g?.guild_name || guildId,
    discord: g ? Number(g.discord) === 1 : false,
    email: email > 0 || await count(db, "SELECT COUNT(*) AS n FROM contact_identities WHERE kind = 'email'") > 0,
    portal: !!Number(cfg?.member_portal_enabled ?? 1),
    widget: !!Number(cfg?.widget_enabled),
    chat: !!Number(cfg?.widget_enabled) && await require('./liveChat').enabled(db).catch(() => false),
    kbPublic: !!Number(cfg?.kb_public),
    sms,
    crm: cfg?.crm_provider || null,
    dev: Object.entries(dev).filter(([, s]) => s?.enabled).map(([k]) => ({ github: 'GitHub', gitlab: 'GitLab', jira: 'Jira' }[k] || k)),
    slackTeams: chatIntegrations > 0,
    webhooks: !!cfg?.webhook_url,
    extensions,
    monitoring,
    assets: !!Number(cfg?.assets_enabled),
    organizations: await count(db, 'SELECT COUNT(*) AS n FROM organizations') > 0,
    surveys: true,
    signatures: await count(db, 'SELECT COUNT(*) AS n FROM signatures') > 0,
    statusPage: !!Number(cfg?.status_page_enabled),
    retention, logs,
  };
}

// The register as a list of processing activities, then the common parts
async function build(db, guildId) {
  const f = await facts(db, guildId);
  const who = await identity(db);
  const months = m => `${m} mois`;
  const days = d => (Number(d) ? `${d} jours` : 'sans limite (réglable)');
  const ticketKeep = f.retention.mode === 'off' ? 'tant que l\'espace existe (aucune règle de rétention réglée)' : `${months(f.retention.months)} après la fermeture, puis ${f.retention.mode === 'delete' ? 'suppression' : 'anonymisation'}`;
  const channels = ['dashboard', f.discord && 'Discord', f.email && 'e-mail', f.portal && 'espace membre web', f.widget && 'widget web', f.chat && 'chat en direct', f.sms && 'SMS (notifications du staff)'].filter(Boolean);
  const recipients = [
    f.discord && 'Discord Inc. (messagerie du serveur et messages privés, États-Unis : clauses contractuelles types)',
    f.email && 'le fournisseur de la boîte e-mail du support (IMAP, SMTP ou API)',
    f.sms && 'la passerelle SMS réglée sur l\'instance (Twilio, OVHcloud ou passerelle HTTP)',
    f.crm && `le CRM ${f.crm === 'hubspot' ? 'HubSpot' : 'Salesforce'} (lecture des fiches par adresse e-mail)`,
    f.dev.length && `${f.dev.join(', ')} (issues créées depuis des tickets)`,
    f.slackTeams && 'Slack ou Microsoft Teams (notifications de l\'équipe)',
    f.webhooks && 'les services appelés par les webhooks sortants de l\'espace',
    f.extensions && `${f.extensions} extension(s) installée(s), dans la limite de leurs permissions`,
  ].filter(Boolean);
  const activities = [
    { name: 'Traitement des demandes d\'assistance (tickets)', purpose: 'Recevoir, suivre et résoudre les demandes des personnes qui contactent le support ; mesurer la qualité du service.',
      basis: 'Exécution d\'un contrat ou mesures précontractuelles (art. 6.1.b), ou intérêt légitime à assister ses utilisateurs (art. 6.1.f).',
      people: 'Personnes qui ouvrent un ticket (clients, utilisateurs, membres du serveur), personnes en copie.',
      data: ['identifiant et pseudonyme Discord', f.email && 'adresse e-mail et nom affiché', 'contenu des messages et pièces jointes', 'enregistrements d\'écran ou vocaux joints', 'champs de formulaire remplis', 'notes de satisfaction et commentaires', f.organizations && 'organisation de rattachement', f.signatures && 'signatures électroniques (nom tapé, adresse IP, navigateur, heure)'].filter(Boolean),
      channels, keep: ticketKeep },
    { name: 'Contacts et organisations', purpose: 'Rattacher les demandes à une personne et à son organisation, appliquer les contrats et les objectifs de délai.',
      basis: 'Intérêt légitime (art. 6.1.f) ou exécution du contrat avec l\'organisation (art. 6.1.b).',
      people: 'Contacts des organisations clientes, demandeurs.', data: ['nom', 'adresse e-mail', 'organisation', 'notes internes du support', f.crm && 'fiche CRM consultée (société, propriétaire, valeur)'].filter(Boolean),
      channels: ['dashboard', f.crm && 'synchronisation CRM'].filter(Boolean), keep: 'tant que la relation existe ; supprimés à la demande (Données membres)' },
    { name: 'Comptes de l\'équipe support', purpose: 'Authentifier le staff, attribuer les tickets, tracer les actions (journal), planifier.',
      basis: 'Exécution du contrat de travail ou de bénévolat (art. 6.1.b), obligation de sécurité (art. 32).',
      people: 'Membres du staff.', data: ['nom affiché, identifiant de connexion, adresse e-mail', 'journal des actions et des connexions (adresses IP)', 'disponibilité, absences, compétences, planning', f.sms && 'numéro de téléphone vérifié (notifications SMS)'].filter(Boolean),
      channels: ['dashboard'], keep: `journal d'activité : ${days(f.logs.auditLogDays)} ; connexions : ${days(f.logs.loginLogsDays)}` },
    f.assets && { name: 'Parc informatique', purpose: 'Suivre le matériel, les logiciels et les licences, et leur lien avec les demandes.', basis: 'Intérêt légitime (art. 6.1.f).',
      people: 'Personnes propriétaires ou utilisatrices d\'un élément.', data: ['élément attribué, numéro de série, lieu', 'licences attribuées'], channels: ['dashboard', 'API'], keep: 'tant que l\'élément est suivi' },
    f.statusPage && { name: 'Abonnements à la page de statut', purpose: 'Prévenir par e-mail des incidents publiés.', basis: 'Consentement (art. 6.1.a), confirmé par un lien.',
      people: 'Personnes abonnées.', data: ['adresse e-mail', 'langue'], channels: ['page de statut publique'], keep: 'jusqu\'au désabonnement' },
  ].filter(Boolean);
  const security = [
    'connexion chiffrée (HTTPS) au dashboard, à l\'API et aux pages publiques',
    'secrets des intégrations chiffrés en base (AES-256-GCM, clé de l\'instance)',
    'mots de passe hachés, double authentification, sessions révocables, verrouillage après inactivité',
    'droits par rôle, grade et équipe ; tickets confidentiels ; journal de chaque action',
    'sauvegardes chiffrées, vérifiées chaque nuit, copiables hors du serveur',
    'données de chaque espace dans sa propre base',
  ];
  return { space: f.space, generatedAt: new Date().toISOString(), identity: who, activities, recipients, security, facts: f };
}

function markdown(r) {
  const L = [];
  L.push(`# Registre des activités de traitement — ${r.space}`, '', `Généré par Datick le ${r.generatedAt.slice(0, 10)}, d'après les réglages de l'espace. À relire et compléter : il décrit ce que l'outil fait, pas l'ensemble des traitements de l'organisme.`, '');
  L.push('## Responsable du traitement', '', `- Responsable : ${r.identity.controller || '_à compléter_'}`, `- Adresse : ${r.identity.address || '_à compléter_'}`, `- Délégué à la protection des données : ${r.identity.dpo || '_aucun ou à compléter_'}`, `- Contact pour l'exercice des droits : ${r.identity.contact || '_à compléter_'}`, '');
  for (const a of r.activities) {
    L.push(`## ${a.name}`, '', `- **Finalité** : ${a.purpose}`, `- **Base légale** : ${a.basis}`, `- **Personnes concernées** : ${a.people}`, `- **Données** : ${a.data.join(' ; ')}`, `- **Canaux** : ${a.channels.join(', ')}`, `- **Durée de conservation** : ${a.keep}`, '');
  }
  L.push('## Destinataires et sous-traitants', '', '- l\'équipe support de l\'espace, selon ses droits', '- l\'hébergeur du serveur de l\'instance', ...r.recipients.map(x => `- ${x}`), '');
  L.push('## Mesures de sécurité', '', ...r.security.map(x => `- ${x}`), '');
  L.push('## Droits des personnes', '', '- accès et portabilité : export JSON des données d\'une personne (Données membres)', '- effacement : suppression des données d\'une personne (Données membres), anonymisation des tickets fermés selon la règle de rétention', '- l\'espace membre montre à chacun ses propres tickets', '');
  if (r.identity.notes) L.push('## Notes', '', r.identity.notes, '');
  return L.join('\n');
}

async function pdf(r) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Registre des traitements — ${r.space}`, Producer: 'Datick' } });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(res => doc.on('end', res));
  for (const line of markdown(r).split('\n')) {
    const clean = line.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/_([^_]+)_/g, '$1');
    if (line.startsWith('# ')) doc.font('Helvetica-Bold').fontSize(16).text(clean.slice(2)).moveDown(0.3);
    else if (line.startsWith('## ')) doc.moveDown(0.4).font('Helvetica-Bold').fontSize(12).text(clean.slice(3)).moveDown(0.2);
    else if (line.startsWith('- ')) doc.font('Helvetica').fontSize(10).text(`• ${clean.slice(2)}`, { indent: 8 });
    else if (line.trim()) doc.font('Helvetica').fontSize(10).text(clean);
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

module.exports = { FIELDS, identity, saveIdentity, facts, build, markdown, pdf };
