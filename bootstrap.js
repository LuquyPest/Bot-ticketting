const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');

const ROOT = __dirname;
const indexPath   = path.join(ROOT, 'index.js');
const deployPath  = path.join(ROOT, 'deploy-commands.js');
const packagePath = path.join(ROOT, 'package.json');

function fail(msg) { console.error(`❌ ${msg}`); process.exit(1); }
function ok(msg)   { console.log(`✅ ${msg}`); }
function info(msg) { console.log(`ℹ️  ${msg}`); }

// config.json (optional) + environment variables — see utils/config.js and docs/guide/installation.md
function readConfig() {
  try { return require('./utils/config').loadConfig(); }
  catch (e) { fail(e.message); }
}

// Names a missing value by its environment variable and its config.json key
const where = (envName, key) => `${envName} (variable d'environnement) ou ${key} (config.json)`;

function validateConfig(config) {
  if (!config.hasFile && !config.token) {
    fail('Aucune configuration trouvée : ni config.json, ni variables d\'environnement. Lance scripts/setup.sh ou lis https://docs.bot.daryu.xyz/guide/installation');
  }
  if (!config.token)    fail(`Champ manquant : ${where('DISCORD_TOKEN', 'token')}`);
  if (!config.clientId) fail(`Champ manquant : ${where('DISCORD_CLIENT_ID', 'clientId')}`);
  if (!config.database?.password) fail(`Champ manquant : ${where('DB_PASSWORD', 'database.password')}`);
  if (config.webEnabled !== false) {
    if (!config.webServerBaseUrl) fail(`Champ manquant : ${where('PUBLIC_URL', 'webServerBaseUrl')}`);
    if (!config.dashboard?.sessionSecret) fail(`Champ manquant : ${where('SESSION_SECRET', 'dashboard.sessionSecret')}`);
    if (config.dashboard.sessionSecret.length < 32)
      fail('Secret de session trop court (min 32 caractères) — génère-en un avec : openssl rand -hex 32');
    if (!config.dashboard?.discordClientSecret) fail(`Champ manquant : ${where('DISCORD_CLIENT_SECRET', 'dashboard.discordClientSecret')}`);
    if (!config.dashboard?.discordCallbackUrl)  fail(`Champ manquant : ${where('DISCORD_CALLBACK_URL', 'dashboard.discordCallbackUrl')}`);
    if (!config.webServerBaseUrl.startsWith('https://') && config.dashboard.discordCallbackUrl?.startsWith('https://')) {
      console.warn('⚠️  L\'URL publique utilise http:// mais l\'URL de retour OAuth utilise https://.');
      console.warn('   Le cookie de session sera Secure grâce à l\'URL de retour.');
      console.warn('   Mets PUBLIC_URL (webServerBaseUrl) en https:// pour supprimer ce message.');
    }
  }
  ok(config.hasFile ? 'Configuration valide (config.json + environnement).' : 'Configuration valide (environnement).');
}

function ensureFilesExist() {
  if (!fs.existsSync(indexPath))   fail('index.js introuvable.');
  if (!fs.existsSync(deployPath))  fail('deploy-commands.js introuvable.');
  if (!fs.existsSync(packagePath)) fail('package.json introuvable.');
  ok('Fichiers principaux trouvés.');
}

function ensureDependenciesInstalled() {
  ['discord.js', 'mysql2', 'otplib', 'qrcode'].forEach(pkg => {
    try { require.resolve(pkg, { paths: [ROOT] }); }
    catch { fail(`${pkg} n'est pas installé. Fais: npm install`); }
  });
  ok('Dépendances installées.');
}

async function ensureGlobalDatabase(config) {
  const { host, port, user, password } = config.database;
  const conn = await mysql.createConnection({ host, port, user, password, multipleStatements: true });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`ticketbot_global\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    ok('Base globale "ticketbot_global" prête.');
  } finally {
    await conn.end();
  }
}

async function ensureGlobalTables(config) {
  const { host, port, user, password } = config.database;
  const conn = await mysql.createConnection({
    host, port, user, password, database: 'ticketbot_global', multipleStatements: true
  });

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS guilds (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        guild_id            VARCHAR(32) NOT NULL UNIQUE,
        guild_name          VARCHAR(200) NOT NULL,
        guild_icon          VARCHAR(200) DEFAULT NULL,
        owner_discord_id    VARCHAR(32) NOT NULL,
        owner_discord_tag   VARCHAR(100) NOT NULL,
        inviter_discord_id  VARCHAR(32) DEFAULT NULL,
        inviter_discord_tag VARCHAR(100) DEFAULT NULL,
        status              ENUM('active','suspended') NOT NULL DEFAULT 'active',
        suspension_reason   VARCHAR(32) DEFAULT NULL,
        maintenance_mode    TINYINT(1) NOT NULL DEFAULT 0,
        db_name             VARCHAR(100) NOT NULL,
        member_count        INT DEFAULT NULL,
        last_activity_at    DATETIME DEFAULT NULL,
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_totp (
        user_id      VARCHAR(32) NOT NULL PRIMARY KEY,
        totp_secret  VARCHAR(64) NOT NULL,
        totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS login_logs (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    VARCHAR(32) NOT NULL,
        username   VARCHAR(100) NOT NULL,
        ip         VARCHAR(45) NOT NULL,
        user_agent VARCHAR(500) DEFAULT NULL,
        country    VARCHAR(3) DEFAULT NULL,
        guild_id   VARCHAR(32) DEFAULT NULL,
        status     ENUM('success','2fa_required','blocked') NOT NULL DEFAULT 'success',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ll_user (user_id),
        INDEX idx_ll_created (created_at)
      );
    `);

    // Migrations for existing rows
    const migrations = [
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS member_count INT DEFAULT NULL`,
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS last_activity_at DATETIME DEFAULT NULL`,
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS maintenance_mode TINYINT(1) NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS user_sessions (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        user_id      VARCHAR(32) NOT NULL,
        session_id   VARCHAR(128) NOT NULL UNIQUE,
        ip           VARCHAR(45) NOT NULL,
        user_agent   VARCHAR(500) DEFAULT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_us_user (user_id)
      )`,
      `CREATE TABLE IF NOT EXISTS error_logs (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        guild_id   VARCHAR(32) DEFAULT NULL,
        context    VARCHAR(100) NOT NULL,
        message    TEXT NOT NULL,
        stack      TEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_el_guild (guild_id),
        INDEX idx_el_created (created_at)
      )`,
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS inviter_discord_id VARCHAR(32) DEFAULT NULL`,
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS inviter_discord_tag VARCHAR(100) DEFAULT NULL`,
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     VARCHAR(32) NOT NULL,
        guild_id    VARCHAR(32) NOT NULL,
        endpoint    TEXT NOT NULL,
        p256dh      TEXT NOT NULL,
        auth_key    TEXT NOT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY idx_sub_endpoint (user_id, guild_id, endpoint(200)),
        INDEX idx_sub_guild (guild_id)
      )`,
      // Encrypted TOTP secrets (utils/secretBox.js) are longer than the old base32 values
      `ALTER TABLE user_totp MODIFY totp_secret VARCHAR(255) NOT NULL`,
      // TOTP replay protection: last accepted time step
      `ALTER TABLE user_totp ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0`,
      // Dashboard 2FA recovery codes (JSON array of sha256 hashes)
      `ALTER TABLE user_totp ADD COLUMN IF NOT EXISTS recovery_codes TEXT DEFAULT NULL`,
      // Per-account preferences shared by every server (last patch notes version seen…)
      `CREATE TABLE IF NOT EXISTS user_prefs (
        user_id      VARCHAR(32) NOT NULL PRIMARY KEY,
        seen_version VARCHAR(20) DEFAULT NULL,
        updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS ui_lang VARCHAR(5) DEFAULT NULL`,
      `ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS split_view TINYINT(1) NOT NULL DEFAULT 0`,
      `ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS tour_done VARCHAR(20) DEFAULT NULL`,
      `ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS ui_skin VARCHAR(10) DEFAULT NULL`,
      // Journal of the instance section (utils/instanceAudit.js)
      `CREATE TABLE IF NOT EXISTS instance_audit_log (
        id         BIGINT AUTO_INCREMENT PRIMARY KEY,
        actor_id   VARCHAR(32) NOT NULL,
        actor_name VARCHAR(100) NOT NULL,
        action     VARCHAR(64) NOT NULL,
        guild_id   VARCHAR(32) DEFAULT NULL,
        details    JSON DEFAULT NULL,
        ip         VARCHAR(64) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ia_created (created_at), INDEX idx_ia_guild (guild_id), INDEX idx_ia_action (action)
      )`,
      // Instance settings (error alert, demonstration server…), JSON values
      `CREATE TABLE IF NOT EXISTS instance_settings (
        k          VARCHAR(64) PRIMARY KEY,
        v          JSON NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      // Up to v2.24 the settings lived in sa_settings: carried over once (fails harmlessly without it)
      `INSERT IGNORE INTO instance_settings (k, v, updated_at) SELECT k, v, updated_at FROM sa_settings`,
      // 'bot_removed' (auto-reactivated on re-invite) vs 'admin' (manual suspension)
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS suspension_reason VARCHAR(32) DEFAULT NULL`,
      // Old session table (sessions live in Redis)
      `DROP TABLE IF EXISTS web_sessions`,
    ];
    for (const m of migrations) await conn.query(m).catch(() => null);

    ok('Tables globales créées ou déjà présentes.');
  } finally {
    await conn.end();
  }
}

async function verifyDiscordToken(config) {
  info('Vérification du token Discord...');
  const { Client, GatewayIntentBits } = require('discord.js');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(config.token);
    ok(`Token Discord valide — ${client.user.tag}`);
  } catch (e) {
    fail(`Token Discord invalide: ${e.message}`);
  } finally {
    client.destroy();
  }
}

function runNodeScript(scriptFile, label) {
  return new Promise((resolve, reject) => {
    info(`${label}...`);
    const child = spawn(process.execPath, [scriptFile], { cwd: ROOT, stdio: 'inherit' });
    child.on('error', e => reject(new Error(`${label} impossible: ${e.message}`)));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${label} a échoué (code ${code})`)));
  });
}

function launchBot() {
  info('Lancement du bot...');
  const child = spawn(process.execPath, ['index.js'], { cwd: ROOT, stdio: 'inherit' });
  child.on('error', e => fail(`Impossible de lancer le bot: ${e.message}`));
  child.on('exit', code => process.exit(code ?? 0));
}

async function main() {
  try {
    info('Vérification de l\'environnement...');
    const config = readConfig();
    validateConfig(config);
    ensureFilesExist();
    ensureDependenciesInstalled();

    info('Connexion MariaDB...');
    await ensureGlobalDatabase(config);
    await ensureGlobalTables(config);

    await verifyDiscordToken(config);
    await runNodeScript('deploy-commands.js', 'Déploiement des commandes slash');

    ok('Tout est prêt. Démarrage du bot multitenant.');
    launchBot();
  } catch (e) {
    fail(e.message || String(e));
  }
}

// Run when started directly (npm start); the test suite only imports the setup functions.
if (require.main === module) main();

module.exports = { ensureGlobalDatabase, ensureGlobalTables };
