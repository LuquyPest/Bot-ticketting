const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');

const ROOT = __dirname;
const configPath = path.join(ROOT, 'config.json');
const indexPath = path.join(ROOT, 'index.js');
const deployPath = path.join(ROOT, 'deploy-commands.js');
const packageJsonPath = path.join(ROOT, 'package.json');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

function info(message) {
  console.log(`ℹ️ ${message}`);
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} introuvable.`);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Impossible de lire ${label}: ${error.message}`);
  }
}

function readConfig() {
  return readJson(configPath, 'config.json');
}

function validateConfig(config) {
  const requiredTopLevel = [
    'token',
    'clientId',
    'guildId',
    'ticketCategoryId',
    'supportRoleId',
    'chiefSupportRoleId',
    'ticketPrefix',
    'database'
  ];

  for (const key of requiredTopLevel) {
    if (!(key in config)) {
      fail(`Champ manquant dans config.json: ${key}`);
    }
  }

  const requiredDb = ['host', 'port', 'user', 'password', 'database'];
  for (const key of requiredDb) {
    if (!(key in config.database)) {
      fail(`Champ manquant dans config.json.database: ${key}`);
    }
  }

  ok('config.json valide.');
}

function ensureFilesExist() {
  if (!fs.existsSync(indexPath)) fail('index.js introuvable.');
  if (!fs.existsSync(deployPath)) fail('deploy-commands.js introuvable.');
  if (!fs.existsSync(packageJsonPath)) fail('package.json introuvable.');
  ok('Fichiers principaux trouvés.');
}

function ensureDependenciesInstalled() {
  try {
    require.resolve('discord.js', { paths: [ROOT] });
  } catch {
    fail('discord.js n’est pas installé. Fais: npm install');
  }

  try {
    require.resolve('mysql2', { paths: [ROOT] });
  } catch {
    fail('mysql2 n’est pas installé. Fais: npm install');
  }

  ok('Dépendances principales installées.');
}

async function ensureDatabase(config) {
  const { host, port, user, password, database } = config.database;

  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\`
     CHARACTER SET utf8mb4
     COLLATE utf8mb4_unicode_ci`
  );

  await connection.end();
  ok(`Base de données "${database}" prête.`);
}

async function ensureTables(config) {
  const { host, port, user, password, database } = config.database;

  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true
  });

  const sql = `
    CREATE TABLE IF NOT EXISTS tickets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      channel_id VARCHAR(32) NOT NULL UNIQUE,
      owner_id VARCHAR(32) NOT NULL,
      owner_tag VARCHAR(100) NOT NULL,
      claimed_by VARCHAR(32) DEFAULT NULL,
      status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME DEFAULT NULL,
      closed_by_tag VARCHAR(100) DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_participants (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id INT NOT NULL,
      user_id VARCHAR(32) NOT NULL,
      added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ticket_participant (ticket_id, user_id),
      CONSTRAINT fk_ticket_participants_ticket
        FOREIGN KEY (ticket_id) REFERENCES tickets(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transcript_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id INT NOT NULL,
      channel_id VARCHAR(32) NOT NULL,
      created_by_id VARCHAR(32) NOT NULL,
      created_by_tag VARCHAR(100) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      message_count INT NOT NULL DEFAULT 0,
      html LONGTEXT NOT NULL,
      txt LONGTEXT NOT NULL,
      CONSTRAINT fk_transcript_ticket
        FOREIGN KEY (ticket_id) REFERENCES tickets(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_stats (
      admin_id VARCHAR(32) PRIMARY KEY,
      admin_tag VARCHAR(100) NOT NULL,
      tickets_claimed INT NOT NULL DEFAULT 0,
      tickets_closed INT NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );
  `;

  await connection.query(sql);
  ok('Tables créées ou déjà présentes.');

  await verifySchema(connection);
  await connection.end();
}

async function getColumns(connection, tableName) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\``);
  return rows.map(row => row.Field);
}

async function verifySchema(connection) {
  const expected = {
    tickets: [
      'id', 'channel_id', 'owner_id', 'owner_tag', 'claimed_by',
      'status', 'created_at', 'closed_at', 'closed_by_tag'
    ],
    ticket_participants: ['id', 'ticket_id', 'user_id', 'added_at'],
    transcript_snapshots: [
      'id', 'ticket_id', 'channel_id', 'created_by_id',
      'created_by_tag', 'created_at', 'message_count', 'html', 'txt'
    ],
    admin_stats: [
      'admin_id', 'admin_tag', 'tickets_claimed', 'tickets_closed', 'updated_at'
    ]
  };

  for (const [table, columns] of Object.entries(expected)) {
    const actualColumns = await getColumns(connection, table);
    for (const column of columns) {
      if (!actualColumns.includes(column)) {
        fail(`Colonne manquante dans la table "${table}": ${column}`);
      }
    }
  }

  ok('Structure SQL vérifiée.');
}

async function verifyDiscordConfig(config) {
  info('Vérification Discord...');

  const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await client.login(config.token);
  } catch (error) {
    fail(`Token Discord invalide ou connexion impossible: ${error.message}`);
  }

  try {
    const guild = await client.guilds.fetch(config.guildId).catch(() => null);
    if (!guild) fail(`Serveur Discord introuvable avec guildId=${config.guildId}`);
    ok(`Serveur trouv�: ${guild.name || guild.id}`);

    const channels = await guild.channels.fetch();
    const roles = await guild.roles.fetch();

    const ticketCategory = channels.get(config.ticketCategoryId);
    if (!ticketCategory) fail(`Catégorie tickets introuvable: ${config.ticketCategoryId}`);
    if (ticketCategory.type !== ChannelType.GuildCategory) fail('ticketCategoryId ne correspond pas à une catégorie Discord.');
    ok(`Catégorie tickets trouvée: ${ticketCategory.name}`);

    const supportRole = roles.get(config.supportRoleId);
    if (!supportRole) fail(`Rôle support introuvable: ${config.supportRoleId}`);
    ok(`Rôle support trouvé: ${supportRole.name}`);

    const chiefSupportRole = roles.get(config.chiefSupportRoleId);
    if (!chiefSupportRole) fail(`Rôle chef support introuvable: ${config.chiefSupportRoleId}`);
    ok(`Rôle chef support trouvé: ${chiefSupportRole.name}`);

    const optionalLogChannels = [
      ['closeLogChannelId', 'log fermeture'],
      ['claimLogChannelId', 'log claim'],
      ['moveLogChannelId', 'log déplacement'],
      ['addUserLogChannelId', 'log ajout utilisateur'],
      ['removeUserLogChannelId', 'log retrait utilisateur']
    ];

    for (const [key, label] of optionalLogChannels) {
      if (!config[key]) {
        info(`Aucun ${label} configuré (${key}).`);
        continue;
      }

      const channel = channels.get(config[key]);
      if (!channel) fail(`Salon introuvable pour ${key}: ${config[key]}`);
      if (channel.type === ChannelType.GuildCategory) fail(`Le channel ${key} ne doit pas être une catégorie.`);
      ok(`Salon ${label} trouvé: ${channel.name}`);
    }
  } finally {
    client.destroy();
  }
}

function runNodeScript(scriptFile, label) {
  return new Promise((resolve, reject) => {
    info(`${label}...`);

    const child = spawn(process.execPath, [scriptFile], {
      cwd: ROOT,
      stdio: 'inherit'
    });

    child.on('error', error => reject(new Error(`${label} impossible: ${error.message}`)));
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${label} a échoué avec le code ${code}`));
    });
  });
}

function launchBot() {
  info('Lancement du bot...');

  const child = spawn(process.execPath, ['index.js'], {
    cwd: ROOT,
    stdio: 'inherit'
  });

  child.on('error', error => fail(`Impossible de lancer le bot: ${error.message}`));
  child.on('exit', code => process.exit(code ?? 0));
}

async function main() {
  try {
    info('Vérification de l’environnement...');
    const config = readConfig();

    validateConfig(config);
    ensureFilesExist();
    ensureDependenciesInstalled();

    info('Connexion MariaDB...');
    await ensureDatabase(config);
    await ensureTables(config);

    await verifyDiscordConfig(config);
    await runNodeScript('deploy-commands.js', 'Déploiement des commandes slash');

    ok('Tout est prêt.');
    launchBot();
  } catch (error) {
    fail(error.message || String(error));
  }
}

main();
