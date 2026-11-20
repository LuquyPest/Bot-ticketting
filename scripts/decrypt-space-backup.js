#!/usr/bin/env node
// Decrypts a space backup downloaded from the dashboard (v8, utils/spaceBackup.js) without Datick:
// Node.js alone, no dependency. Writes the JSON lines (one table row or one stored file per line).
//   DATICK_PASSPHRASE='…' node scripts/decrypt-space-backup.js datick-espace-….datick > espace.jsonl
// Format: "DATICKS1" · salt (16 bytes) · iv (12) · AES-256-GCM(gzip(JSON lines)) · tag (16),
// key = scrypt(passphrase, salt, 32, N = 2^15, r = 8, p = 1). See the docs: Sauvegardes → Sauvegarde d'un espace.
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
const pass = process.env.DATICK_PASSPHRASE;
if (!file || !pass) { console.error('Usage : DATICK_PASSPHRASE=… node decrypt-space-backup.js <fichier.datick> > espace.jsonl'); process.exit(2); }
const buf = fs.readFileSync(file);
if (buf.subarray(0, 8).toString() !== 'DATICKS1') { console.error('Ce fichier n\'est pas une sauvegarde d\'espace Datick'); process.exit(1); }
const key = crypto.scryptSync(pass, buf.subarray(8, 24), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(24, 36));
d.setAuthTag(buf.subarray(buf.length - 16));
let gz;
try { gz = Buffer.concat([d.update(buf.subarray(36, buf.length - 16)), d.final()]); } catch { console.error('Phrase de passe incorrecte, ou fichier modifié'); process.exit(1); }
process.stdout.write(zlib.gunzipSync(gz));
