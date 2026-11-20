// What the demonstration server shows of the v7 functions (v8, conception/v8.md §3.1): teams with
// support levels, skills, organisations with contracts, an inventory with relations, changes, a
// release and a change advisory board meeting, a status page (never public: the demo server is not
// a row of `guilds`, which the public page requires). Every step is through the modules themselves,
// so the data is what a real space would hold; a step that fails on an older schema is skipped.
const TABLES = ['cab_votes', 'cab_agenda', 'cab_meetings', 'cab_members', 'release_steps', 'release_changes', 'releases', 'change_links', 'change_tasks', 'change_approvals', 'changes',
  'asset_links', 'asset_relations', 'asset_history', 'assets', 'asset_types', 'contracts', 'organization_domains', 'organizations',
  'ticket_skills', 'subject_skills', 'staff_skills', 'skills', 'team_members', 'teams', 'status_component_events', 'status_components', 'status_subscribers', 'monitoring_alerts', 'monitoring_sources', 'extensions'];

const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const at = h => new Date(Date.now() + h * 3600000);

async function step(name, fn) {
  try { return await fn(); } catch (err) { console.error(`démo (${name}) :`, err.message); return null; }
}

async function seedExtras(db, { staff, tickets, founderId }) {
  const actor = { id: founderId, tag: 'Visiteur démo', username: 'Visiteur démo' };
  const [lea, hugo, ines] = staff.slice(1).map(s => s[0]);

  // Teams with their support level, and skills
  const teams = require('./teams');
  const n1 = await step('équipes', async () => (await teams.createTeam(db, { name: 'Support N1', color: '#3498db', assignMode: 'round_robin', level: 1, members: [hugo, ines], subjects: ['Compte', 'Autre'] })).id);
  const n2 = await step('équipes', async () => (await teams.createTeam(db, { name: 'Experts N2', color: '#9b59b6', assignMode: 'load', level: 2, members: [lea], subjects: ['Paiement', 'Bug en jeu'] })).id);
  await step('compétences', async () => {
    const sk = require('./skills');
    const ids = {};
    for (const name of ['Facturation', 'Technique', 'Modération', 'Anglais écrit']) ids[name] = (await sk.createSkill(db, name)).id;
    await sk.saveStaff(db, lea, { skills: [ids.Facturation, ids.Technique], languages: ['fr', 'en'] });
    await sk.saveStaff(db, hugo, { skills: [ids.Technique], languages: ['fr'] });
    await sk.saveStaff(db, ines, { skills: [ids.Modération, ids['Anglais écrit']], languages: ['fr', 'en', 'es'] });
    await sk.saveSubjectMap(db, { Paiement: [ids.Facturation], 'Bug en jeu': [ids.Technique], Signalement: [ids.Modération] });
  });
  for (const t of tickets.filter(x => x.open)) {
    const team = ['Paiement', 'Bug en jeu'].includes(t.subject) ? n2 : n1;
    if (team) await db('UPDATE tickets SET team_id = ? WHERE id = ?', [team, t.id]).catch(() => null);
  }

  // Organisations and their contracts
  const orgs = require('./organizations');
  const acme = await step('organisations', async () => (await orgs.saveOrg(db, null, { name: 'Acme Studio', domains: ['acme-studio.example'], teamId: n2, managerId: lea, portalVisibility: 'manager', notes: 'Client depuis 2024.' })).id);
  const nova = await step('organisations', async () => (await orgs.saveOrg(db, null, { name: 'Nova Esport', domains: ['nova-esport.example'], teamId: n1, portalVisibility: 'all' })).id);
  if (acme) await step('contrats', () => require('./contracts').saveContract(db, acme, null, { name: 'Forfait 40 h — 2026', kind: 'hours', quota: 40, startsOn: day(-200), endsOn: day(165), alertPercent: 80, alertDays: 30, autoRenew: true }, actor));
  if (nova) await step('contrats', () => require('./contracts').saveContract(db, nova, null, { name: 'Pack 25 tickets', kind: 'tickets', quota: 25, startsOn: day(-60), endsOn: day(20), alertPercent: 80, alertDays: 30 }, actor));
  for (const [i, t] of tickets.entries()) if (i % 3 === 0 && (acme || nova)) await db('UPDATE tickets SET organization_id = ? WHERE id = ?', [i % 2 ? nova || acme : acme || nova, t.id]).catch(() => null);

  // Inventory: types, elements, relations, links to tickets
  const assetIds = {};
  await step('parc', async () => {
    await db('UPDATE guild_config SET assets_enabled = 1, changes_enabled = 1 WHERE id = 1');
    const A = require('./assets');
    const pc = (await A.saveType(db, null, { name: 'Ordinateur', icon: '💻', fields: [{ label: 'Système', type: 'choice', options: ['Windows 11', 'macOS', 'Linux'] }, { label: 'Mémoire (Go)', type: 'number' }] })).id;
    const srv = (await A.saveType(db, null, { name: 'Serveur', icon: '🖥️', fields: [{ label: 'Adresse IP', type: 'text' }, { label: 'Hébergeur', type: 'text' }] })).id;
    const app = (await A.saveType(db, null, { name: 'Service', icon: '🧩', fields: [{ label: 'URL', type: 'text' }] })).id;
    const add = async (key, input) => { assetIds[key] = (await A.createAsset(db, input, actor)).id; };
    await add('game', { typeId: srv, name: 'game-eu-1', serial: 'SRV-0001', location: 'Paris (DC2)', fields: { adresse_ip: '10.0.1.10', hebergeur: 'OVHcloud' } });
    await add('db', { typeId: srv, name: 'db-main', serial: 'SRV-0002', location: 'Paris (DC2)', fields: { adresse_ip: '10.0.1.20', hebergeur: 'OVHcloud' } });
    await add('shop', { typeId: app, name: 'Boutique en ligne', fields: { url: 'https://boutique.example' }, ownerOrgId: acme || null });
    await add('launcher', { typeId: app, name: 'Lanceur du jeu', fields: { url: 'https://jeu.example/telecharger' } });
    await add('pc1', { typeId: pc, name: 'PC-ACME-01', serial: 'C02XK1', status: 'in_use', ownerOrgId: acme || null, fields: { systeme: 'Windows 11', memoire_go: 16 } });
    await add('pc2', { typeId: pc, name: 'PC-ACME-02', serial: 'C02XK2', status: 'maintenance', ownerOrgId: acme || null, fields: { systeme: 'macOS', memoire_go: 32 } });
    await A.relate(db, assetIds.game, assetIds.db, 'depends_on', actor);
    await A.relate(db, assetIds.shop, assetIds.db, 'depends_on', actor);
    await A.relate(db, assetIds.launcher, assetIds.game, 'depends_on', actor);
    const L = require('./assetLinks');
    for (const t of tickets.filter(x => x.subject === 'Bug en jeu').slice(0, 3)) await L.link(db, assetIds.game, 'ticket', t.id);
    for (const t of tickets.filter(x => x.subject === 'Paiement').slice(0, 2)) await L.link(db, assetIds.shop, 'ticket', t.id);
  });

  // Changes, a release and a meeting of the change advisory board
  await step('changements', async () => {
    const C = require('./changes');
    const c1 = (await C.createChange(db, { title: 'Mise à jour du moteur de jeu 2.4', risk: 'medium', assigneeId: lea, teamId: n2 }, actor)).id;
    const c2 = (await C.createChange(db, { title: 'Migration de la base vers MariaDB 11', risk: 'high', assigneeId: hugo, teamId: n2 }, actor)).id;
    const c3 = (await C.createChange(db, { title: 'Nouveau moyen de paiement', risk: 'low', assigneeId: lea }, actor)).id;
    if (assetIds.game) await require('./assetLinks').link(db, assetIds.game, 'change', c1);
    if (assetIds.db) await require('./assetLinks').link(db, assetIds.db, 'change', c2);
    const R = require('./releases');
    const rel = (await R.createRelease(db, { title: 'Version 2.4 du jeu', assigneeId: lea, startsAt: at(48), endsAt: at(50), rollbackPlan: 'Remettre l\'image 2.3 sur game-eu-1 et rejouer la sauvegarde de la base.' }, actor)).id;
    await R.addChange(db, rel, c1, actor);
    await R.addChange(db, rel, c3, actor);
    for (const [stage, title] of [['preparation', 'Geler les fonctionnalités'], ['preparation', 'Prévenir les joueurs'], ['test', 'Recette sur le serveur de test'], ['deployment', 'Déployer sur game-eu-1'], ['verification', 'Vérifier les connexions et la boutique']]) await R.addStep(db, rel, stage, title);
    const firstStep = (await db('SELECT id FROM release_steps WHERE release_id = ? ORDER BY id LIMIT 1', [rel]))[0];
    if (firstStep) await R.setStep(db, rel, firstStep.id, true, { username: 'Léa' });
    const cab = require('./cab');
    await cab.setMembers(db, [founderId, lea, hugo]);
    const meeting = (await cab.saveMeeting(db, null, { title: 'Comité des changements — semaine prochaine', startsAt: at(72) }, actor)).id;
    await cab.addToAgenda(db, meeting, c1);
    await cab.addToAgenda(db, meeting, c2);
    await cab.vote(db, meeting, c1, lea, 'for', 'Testé sur le serveur de recette.');
    await cab.vote(db, meeting, c2, hugo, 'reserve', 'Prévoir une fenêtre de maintenance la nuit.');
  });

  // Status page: components and their state (the public page stays off: not a real space)
  await step('page de statut', async () => {
    const S = require('./statusPage');
    await S.saveSettings(db, { enabled: false, title: 'État des services' });
    const ids = [];
    for (const [name, description] of [['Serveurs de jeu', 'Connexion et parties'], ['Boutique', 'Achats et abonnements'], ['Site et forum', ''], ['Support', 'Tickets et chat']]) ids.push((await S.saveComponent(db, null, { name, description })).id);
    if (ids[1]) await S.setComponentStatus(db, ids[1], 'degraded', actor);
  });
}

module.exports = { TABLES, seedExtras };
