const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');

const ROOT = __dirname;
// Same resolution as utils/config.js, without loading the file (a missing config gets a clear message)
const configPath  = process.env.TICKETBOT_CONFIG ? path.resolve(process.env.TICKETBOT_CONFIG) : path.join(ROOT, 'config.json');
const indexPath   = path.join(ROOT, 'index.js');
const deployPath  = path.join(ROOT, 'deploy-commands.js');
const packagePath = path.join(ROOT, 'package.json');

function fail(msg) { console.error(`❌ ${msg}`); process.exit(1); }
function ok(msg)   { console.log(`✅ ${msg}`); }
function info(msg) { console.log(`ℹ️  ${msg}`); }

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`${label} introuvable.`);
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) { fail(`Impossible de lire ${label}: ${e.message}`); }
}

function readConfig() { return readJson(configPath, 'config.json'); }

function validateConfig(config) {
  const required = ['token', 'clientId', 'webServerPort', 'webServerBaseUrl', 'database'];
  for (const key of required) {
    if (!(key in config)) fail(`Champ manquant dans config.json: ${key}`);
  }
  const requiredDb = ['host', 'port', 'user', 'password', 'database'];
  for (const key of requiredDb) {
    if (!(key in config.database)) fail(`Champ manquant dans config.json.database: ${key}`);
  }
  if (config.webEnabled !== false) {
    if (!config.dashboard?.sessionSecret)        fail('Champ manquant: dashboard.sessionSecret');
    if (config.dashboard.sessionSecret.length < 32)
      fail('dashboard.sessionSecret trop court (min 32 caractères) — génère-en un avec: openssl rand -hex 32');
    if (!config.dashboard?.discordClientSecret)  fail('Champ manquant: dashboard.discordClientSecret');
    if (!config.dashboard?.discordCallbackUrl)   fail('Champ manquant: dashboard.discordCallbackUrl');
    if (config.webServerBaseUrl && !config.webServerBaseUrl.startsWith('https://') &&
        config.dashboard.discordCallbackUrl?.startsWith('https://')) {
      console.warn('⚠️  webServerBaseUrl utilise http:// mais discordCallbackUrl utilise https://.');
      console.warn('   Le cookie de session sera Secure grâce à discordCallbackUrl.');
      console.warn('   Mets webServerBaseUrl à https:// pour supprimer ce message.');
    }
  }
  ok('config.json valide.');
}

function ensureFilesExist() {
  if (!fs.existsSync(indexPath))   fail('index.js introuvable.');
  if (!fs.existsSync(deployPath))  fail('deploy-commands.js introuvable.');
  if (!fs.existsSync(packagePath)) fail('package.json introuvable.');
  ok('Fichiers principaux trouvés.');
}

function ensureDependenciesInstalled() {
  ['discord.js', 'mysql2', 'bcrypt', 'otplib', 'qrcode'].forEach(pkg => {
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
      CREATE TABLE IF NOT EXISTS superadmins (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        username     VARCHAR(80) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        totp_secret  VARCHAR(64) DEFAULT NULL,
        totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS managers (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        username         VARCHAR(80) NOT NULL UNIQUE,
        password_hash    VARCHAR(255) NOT NULL,
        assigned_guilds  JSON NOT NULL DEFAULT ('[]'),
        created_by       INT DEFAULT NULL,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_mgr_sa FOREIGN KEY (created_by) REFERENCES superadmins(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS guilds (
        id                 INT AUTO_INCREMENT PRIMARY KEY,
        guild_id           VARCHAR(32) NOT NULL UNIQUE,
        guild_name         VARCHAR(200) NOT NULL,
        guild_icon         VARCHAR(200) DEFAULT NULL,
        owner_discord_id   VARCHAR(32) NOT NULL,
        owner_discord_tag  VARCHAR(100) NOT NULL,
        status             ENUM('pending','active','suspended') NOT NULL DEFAULT 'pending',
        db_name            VARCHAR(100) NOT NULL,
        activation_token   VARCHAR(128) DEFAULT NULL,
        token_expires_at   DATETIME DEFAULT NULL,
        approved_by        INT DEFAULT NULL,
        approved_at        DATETIME DEFAULT NULL,
        member_count       INT DEFAULT NULL,
        last_activity_at   DATETIME DEFAULT NULL,
        created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_guild_approver FOREIGN KEY (approved_by) REFERENCES superadmins(id) ON DELETE SET NULL
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
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS activation_token VARCHAR(128) DEFAULT NULL`,
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS token_expires_at DATETIME DEFAULT NULL`,
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS member_count INT DEFAULT NULL`,
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS last_activity_at DATETIME DEFAULT NULL`,
      `ALTER TABLE managers ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64) DEFAULT NULL`,
      `ALTER TABLE managers ADD COLUMN IF NOT EXISTS totp_enabled TINYINT(1) NOT NULL DEFAULT 0`,
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS maintenance_mode TINYINT(1) NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS sa_auth_logs (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        username   VARCHAR(100) NOT NULL,
        ip         VARCHAR(45) NOT NULL,
        user_agent VARCHAR(500) DEFAULT NULL,
        status     ENUM('failed','totp_failed','success') NOT NULL DEFAULT 'failed',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sal_created (created_at),
        INDEX idx_sal_username (username)
      )`,
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
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS max_tickets INT NOT NULL DEFAULT 0`,
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS max_agents INT NOT NULL DEFAULT 0`,
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS transcript_retention_days INT NOT NULL DEFAULT 0`,
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
      `ALTER TABLE superadmins MODIFY totp_secret VARCHAR(255) DEFAULT NULL`,
      `ALTER TABLE managers MODIFY totp_secret VARCHAR(255) DEFAULT NULL`,
      `ALTER TABLE user_totp MODIFY totp_secret VARCHAR(255) NOT NULL`,
      // TOTP replay protection: last accepted time step
      `ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0`,
      `ALTER TABLE managers ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0`,
      `ALTER TABLE user_totp ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0`,
      // Dashboard 2FA recovery codes (JSON array of sha256 hashes)
      `ALTER TABLE user_totp ADD COLUMN IF NOT EXISTS recovery_codes TEXT DEFAULT NULL`,
      // Per-account lockout for superadmin/manager logins
      `ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0`,
      `ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS locked_until DATETIME DEFAULT NULL`,
      `ALTER TABLE managers ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0`,
      `ALTER TABLE managers ADD COLUMN IF NOT EXISTS locked_until DATETIME DEFAULT NULL`,
      // Plans: preset limits assigned to guilds (copied into guilds.max_*)
      `CREATE TABLE IF NOT EXISTS plans (
        id                        INT AUTO_INCREMENT PRIMARY KEY,
        name                      VARCHAR(60) NOT NULL UNIQUE,
        description               VARCHAR(255) DEFAULT NULL,
        max_tickets               INT NOT NULL DEFAULT 0,
        max_agents                INT NOT NULL DEFAULT 0,
        transcript_retention_days INT NOT NULL DEFAULT 0,
        created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS plan_id INT DEFAULT NULL`,
      // Journal of the super-admin panel (utils/saAudit.js)
      `CREATE TABLE IF NOT EXISTS sa_audit_log (
        id         BIGINT AUTO_INCREMENT PRIMARY KEY,
        actor_id   INT NOT NULL,
        actor_name VARCHAR(100) NOT NULL,
        actor_type VARCHAR(16) NOT NULL,
        action     VARCHAR(64) NOT NULL,
        guild_id   VARCHAR(32) DEFAULT NULL,
        details    JSON DEFAULT NULL,
        ip         VARCHAR(64) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_saa_created (created_at), INDEX idx_saa_guild (guild_id), INDEX idx_saa_action (action)
      )`,
      // Super-admin settings (error alert, plans…), JSON values
      `CREATE TABLE IF NOT EXISTS sa_settings (
        k          VARCHAR(64) PRIMARY KEY,
        v          JSON NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      // 'bot_removed' (auto-reactivated on re-invite) vs 'admin' (manual suspension)
      `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS suspension_reason VARCHAR(32) DEFAULT NULL`,
    ];
    for (const m of migrations) await conn.query(m).catch(() => null);

    ok('Tables globales créées ou déjà présentes.');
  } finally {
    await conn.end();
  }
}

async function seedSuperAdmin(config) {
  const username = process.env.SA_USERNAME?.trim();
  const password = process.env.SA_PASSWORD;
  if (!username || !password) return;

  const { host, port, user, password: dbPass } = config.database;
  const conn = await mysql.createConnection({ host, port, user, password: dbPass, database: 'ticketbot_global' });
  try {
    const [rows] = await conn.query('SELECT COUNT(*) AS n FROM superadmins');
    if (rows[0].n > 0) {
      info('Compte superadmin déjà existant — SA_USERNAME/SA_PASSWORD ignorés.');
      return;
    }
    // Checked only when the account is actually created: an existing install must still boot
    if (password.length < 12) fail('SA_PASSWORD doit faire au moins 12 caractères pour créer le compte superadmin.');
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(password, 12);
    await conn.query('INSERT INTO superadmins (username, password_hash) VALUES (?, ?)', [username, hash]);
    ok(`Compte superadmin "${username}" créé. Retire SA_USERNAME et SA_PASSWORD du .env après le premier démarrage.`);
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
    await seedSuperAdmin(config);

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

module.exports = { ensureGlobalDatabase, ensureGlobalTables, seedSuperAdmin };
