// Images of the knowledge base articles (v6, conception/v6.md §3.2): sent from the article editor,
// written to disk under a random name (ATTACHMENTS_DIR/kb/<space>/), referenced in the answer as
//   ![text](/api/kb/<space>/images/<token>)
// and served with the article's visibility (utils/knowledgeBase.js). PNG, JPEG, GIF, WebP only
// (no SVG: it can carry scripts), checked by their first bytes, 5 MB at most, 30 per article.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('./config');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PER_ARTICLE = 30;
const SNOWFLAKE = /^\d{17,20}$/;
const TOKEN_RE = /^[0-9a-f]{32}$/;
// The image syntax, only for our own paths (no outside image: nothing tracks the readers)
const IMG_RE = /!\[([^\]\n]{0,200})\]\((\/api\/kb\/(\d{17,20})\/images\/([0-9a-f]{32}))\)/g;

const baseDir = () => config.attachmentsDir || process.env.ATTACHMENTS_DIR || '/app/data/attachments';
function dirOf(guildId) {
  if (!SNOWFLAKE.test(String(guildId))) throw new Error('Espace invalide');
  return path.join(baseDir(), 'kb', String(guildId));
}

// The type from the first bytes (the browser's own type is not trusted)
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// { url, markdown } or { error, status }
async function store(db, guildId, faqId, file) {
  if (!file?.buffer) return { error: 'Aucune image reçue', status: 400 };
  if (file.buffer.length > MAX_BYTES) return { error: 'Image trop lourde (5 Mo au plus)', status: 413 };
  const type = sniff(file.buffer);
  if (!type) return { error: 'Format refusé : PNG, JPEG, GIF ou WebP', status: 415 };
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM faq_images WHERE faq_id = ?', [faqId]);
  if (Number(n) >= MAX_PER_ARTICLE) return { error: `${MAX_PER_ARTICLE} images au plus par article`, status: 400 };
  const token = crypto.randomBytes(16).toString('hex');
  const stored = crypto.randomBytes(16).toString('hex');
  const dir = dirOf(guildId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, stored), file.buffer, { mode: 0o600 });
  const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
  await db('INSERT INTO faq_images (token, faq_id, content_type, size, sha256, stored_name) VALUES (?, ?, ?, ?, ?, ?)', [token, faqId, type, file.buffer.length, sha, stored]);
  const url = `/api/kb/${guildId}/images/${token}`;
  const alt = String(file.originalname || 'image').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[[\]()\n]/g, ' ').trim().slice(0, 80) || 'image';
  return { url, markdown: `![${alt}](${url})` };
}

// The image and the article it belongs to, or null
async function find(db, token) {
  if (!TOKEN_RE.test(String(token))) return null;
  const [r] = await db(`SELECT i.*, f.visibility, (${require('./knowledgeBase').LIVE.replace(/\b(active|status|expires_at)\b/g, 'f.$1')}) AS live
    FROM faq_images i JOIN faq_entries f ON f.id = i.faq_id WHERE i.token = ?`, [token]).catch(() => []);
  return r || null;
}
const fileOf = (guildId, img) => path.join(dirOf(guildId), img.stored_name);

// Files of an article that is being deleted (the rows go with it)
async function removeForArticle(db, guildId, faqId) {
  const rows = await db('SELECT stored_name FROM faq_images WHERE faq_id = ?', [faqId]).catch(() => []);
  for (const r of rows) { try { fs.rmSync(fileOf(guildId, r), { force: true }); } catch { /* already gone */ } }
}

// Text contexts (Discord DM, plain-text e-mail): « text: https://…/api/kb/…/images/… »
function toLinks(md) {
  const base = (config.webServerBaseUrl || '').replace(/\/$/, '');
  return String(md || '').replace(IMG_RE, (m, alt, p) => `${alt || 'Image'} : ${base}${p}`);
}

module.exports = { MAX_BYTES, MAX_PER_ARTICLE, IMG_RE, sniff, store, find, fileOf, removeForArticle, toLinks, dirOf };
