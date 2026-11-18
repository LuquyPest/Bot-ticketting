#!/usr/bin/env node
// Re-encrypts every stored secret (2FA of the dashboard accounts, passwords and OAuth2 tokens of
// the support mailboxes, secrets of the sign-in providers and of the mailbox OAuth2 applications) and every
// transcript of every server with the current key (ENCRYPTION_KEY / dashboard.encryptionKey); transcripts
// still in clear (written before encryption) are encrypted too. Run after setting the new key and
// moving the old one to dashboard.previousEncryptionKeys (or once to encrypt old transcripts):
//   docker compose exec bot node scripts/rotate-encryption-key.js
//   node scripts/rotate-encryption-key.js --generate   (prints a new random key)
const crypto = require('crypto');

if (process.argv.includes('--generate')) {
  console.log(crypto.randomBytes(32).toString('hex'));
  process.exit(0);
}

const TABLES = [
  ['user_totp', 'user_id'],
];

async function rotate() {
  const { globalQuery } = require('../utils/globalDb');
  const box = require('../utils/secretBox');
  box.resetKeys();
  const report = {};
  for (const [table, pk] of TABLES) {
    const rows = await globalQuery(`SELECT ${pk} AS id, totp_secret FROM ${table} WHERE totp_secret IS NOT NULL AND totp_secret <> ''`);
    report[table] = { total: rows.length, rewritten: 0, failed: 0 };
    for (const r of rows) {
      if (box.isCurrent(r.totp_secret)) continue;
      try {
        const plain = box.open(r.totp_secret);
        await globalQuery(`UPDATE ${table} SET totp_secret = ? WHERE ${pk} = ?`, [box.seal(plain), r.id]);
        report[table].rewritten++;
      } catch (err) {
        report[table].failed++;
        console.error(`${table} ${r.id} : ${err.message}`);
      }
    }
  }
  report.transcripts = await rotateTranscripts(box);
  report.emailPasswords = await rotateEmailPasswords(box);
  report.instanceEmail = await rotateInstanceEmail(box);
  report.loginProviders = await rotateProviderSecrets(box, 'login_providers');
  report.mailOAuth = await rotateProviderSecrets(box, 'mail_oauth');
  return report;
}

// clientSecret of each provider in an instance setting: Instance → Connexion (sign-in providers,
// mailbox OAuth2 applications)
async function rotateProviderSecrets(box, key) {
  const { getSetting, setSetting } = require('../utils/instanceSettings');
  const s = await getSetting(key, {});
  const out = { total: 0, rewritten: 0, failed: 0 };
  const next = { ...s };
  for (const [k, p] of Object.entries(s || {})) {
    if (!p || typeof p !== 'object' || !p.clientSecret) continue;
    out.total++;
    if (box.isCurrent(p.clientSecret)) continue;
    try { next[k] = { ...p, clientSecret: box.seal(box.open(p.clientSecret)) }; out.rewritten++; }
    catch (err) { out.failed++; console.error(`${key}/${k} : ${err.message}`); }
  }
  if (out.rewritten) await setSetting(key, next);
  return out;
}

// Password of the SMTP server of the instance (Instance → Santé → E-mail de l'instance)
async function rotateInstanceEmail(box) {
  const { getSetting, setSetting } = require('../utils/instanceSettings');
  const s = await getSetting('instance_email', {});
  if (!s.password) return { total: 0, rewritten: 0, failed: 0 };
  if (box.isCurrent(s.password)) return { total: 1, rewritten: 0, failed: 0 };
  try { await setSetting('instance_email', { ...s, password: box.seal(box.open(s.password)) }); return { total: 1, rewritten: 1, failed: 0 }; }
  catch (err) { console.error(`e-mail de l'instance : ${err.message}`); return { total: 1, rewritten: 0, failed: 1 }; }
}

// Passwords of the support mailboxes (tickets by e-mail), one row per server
async function rotateEmailPasswords(box) {
  const { globalQuery } = require('../utils/globalDb');
  const { getTenantDb } = require('../utils/tenantDb');
  const out = { total: 0, rewritten: 0, failed: 0 };
  for (const { guild_id } of await globalQuery("SELECT guild_id FROM guilds WHERE status IN ('active', 'suspended')")) {
    const db = getTenantDb(guild_id);
    const [row] = await db('SELECT * FROM email_settings WHERE id = 1').catch(() => []);
    if (!row) continue;
    for (const col of ['imap_password', 'smtp_password', 'oauth_refresh', 'oauth_access', 'inbound_token', 'inbound_secret']) {
      if (!row[col]) continue;
      out.total++;
      if (box.isCurrent(row[col])) continue;
      try {
        await db(`UPDATE email_settings SET ${col} = ? WHERE id = 1`, [box.seal(box.open(row[col]))]);
        out.rewritten++;
      } catch (err) {
        out.failed++;
        console.error(`e-mail ${guild_id}/${col} : ${err.message}`);
      }
    }
  }
  return out;
}

// Transcripts, server by server, in small batches (they can be large)
async function rotateTranscripts(box) {
  const { globalQuery } = require('../utils/globalDb');
  const { getTenantDb } = require('../utils/tenantDb');
  const { sealTranscript, openTranscript } = require('../utils/transcriptCrypto');
  const out = { total: 0, rewritten: 0, failed: 0 };
  for (const { guild_id } of await globalQuery("SELECT guild_id FROM guilds WHERE status IN ('active', 'suspended')")) {
    let db;
    try { db = getTenantDb(guild_id); await db('SELECT 1 FROM transcript_snapshots LIMIT 1'); } catch { continue; }
    let lastId = 0;
    for (;;) {
      const rows = await db('SELECT id, html, txt FROM transcript_snapshots WHERE id > ? ORDER BY id LIMIT 20', [lastId]);
      if (!rows.length) break;
      for (const r of rows) {
        lastId = r.id;
        out.total++;
        if (box.isCurrent(r.html) && box.isCurrent(r.txt)) continue;
        try {
          const html = openTranscript(r.html), txt = openTranscript(r.txt);
          const sealedHtml = sealTranscript(html), sealedTxt = sealTranscript(txt);
          // Never write something that would not read back
          if (openTranscript(sealedHtml) !== html || openTranscript(sealedTxt) !== txt) throw new Error('vérification du chiffrement échouée');
          await db('UPDATE transcript_snapshots SET html = ?, txt = ? WHERE id = ?', [sealedHtml, sealedTxt, r.id]);
          out.rewritten++;
        } catch (err) {
          out.failed++;
          console.error(`transcript ${guild_id}/${r.id} : ${err.message}`);
        }
      }
    }
  }
  return out;
}

if (require.main === module) {
  rotate().then(async report => {
    console.log(JSON.stringify(report, null, 2));
    await require('../utils/globalDb').getPool().end().catch(() => {});
    const failed = Object.values(report).reduce((n, t) => n + (t.failed || 0), 0);
    process.exit(failed ? 1 : 0);
  }).catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { rotate };
