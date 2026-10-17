#!/usr/bin/env node
// Re-encrypts every stored secret (2FA of dashboard users, super-admins, managers) with the
// current key (config.dashboard.encryptionKey). Run after setting the new key and moving the old
// one to dashboard.previousEncryptionKeys:
//   docker compose exec bot node scripts/rotate-encryption-key.js
//   node scripts/rotate-encryption-key.js --generate   (prints a new random key)
const crypto = require('crypto');

if (process.argv.includes('--generate')) {
  console.log(crypto.randomBytes(32).toString('hex'));
  process.exit(0);
}

const TABLES = [
  ['user_totp', 'user_id'],
  ['superadmins', 'id'],
  ['managers', 'id'],
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
  return report;
}

if (require.main === module) {
  rotate().then(async report => {
    console.log(JSON.stringify(report, null, 2));
    await require('../utils/globalDb').getPool().end().catch(() => {});
    const failed = Object.values(report).reduce((n, t) => n + t.failed, 0);
    process.exit(failed ? 1 : 0);
  }).catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { rotate };
