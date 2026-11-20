// Simple electronic signature (v8, conception/v8.md §3.5) of a change, a release or a ticket (a
// delivery). The staff asks a person (a contact or someone outside, by e-mail; a staff member, by
// the same link) to sign; the document is frozen when asked (its text and its SHA-256). The person
// opens a one-time link (14 days, only its SHA-256 kept), reads, types their name and ticks « je
// valide » (or refuses, with a reason). Kept: the name typed, the address, the time, the IP, the
// browser, the fingerprint of what was signed; a PDF certificate. A « simple » signature in the eIDAS
// sense, not a qualified one. A signature, once given, never changes.
const crypto = require('crypto');
const { recordEvent } = require('./audit');

const TARGETS = ['change', 'release', 'ticket'];
const LINK_DAYS = 14, MAX_TEXT = 20000, MAX_PENDING = 20;
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const base = () => (require('./config').config.webServerBaseUrl || '').replace(/\/$/, '');
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const clip = (v, n) => String(v ?? '').slice(0, n);

// The document of a target, as the person will read it (plain text, frozen)
async function documentOf(db, type, id, extra = '') {
  let title, parts;
  if (type === 'change') {
    const [c] = await db('SELECT * FROM changes WHERE id = ?', [id]);
    if (!c) return null;
    title = `Changement #${c.id} — ${c.title}`;
    parts = [['Description', c.description], ['Niveau de risque', c.risk], ['Risques', c.risks], ['Impact', c.impact], ['Plan de déploiement', c.deploy_plan], ['Plan de retour arrière', c.rollback_plan], ['Créneau', c.starts_at ? `${new Date(c.starts_at).toISOString()} → ${c.ends_at ? new Date(c.ends_at).toISOString() : '—'}` : null]];
  } else if (type === 'release') {
    const [r] = await db('SELECT * FROM releases WHERE id = ?', [id]);
    if (!r) return null;
    const changes = await db('SELECT c.id, c.title FROM release_changes rc JOIN changes c ON c.id = rc.change_id WHERE rc.release_id = ? ORDER BY c.id', [id]).catch(() => []);
    title = `Mise en production #${r.id} — ${r.title}`;
    parts = [['Description', r.description], ['Changements', changes.map(c => `#${c.id} ${c.title}`).join('\n')], ['Plan de retour arrière', r.rollback_plan], ['Bilan', r.review]];
  } else {
    const [t] = await db('SELECT id, subject, status FROM tickets WHERE id = ?', [id]);
    if (!t) return null;
    title = `Livraison — ticket #${t.id}${t.subject ? ` (${t.subject})` : ''}`;
    const [last] = await db("SELECT content FROM ticket_notes WHERE ticket_id = ? AND source IN ('reply', 'resolution') ORDER BY id DESC LIMIT 1", [id]).catch(() => []);
    parts = [['Ce qui a été fait', last?.content]];
  }
  if (extra) parts.push(['Précisions', extra]);
  const text = parts.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k}\n${String(v).trim()}`).join('\n\n').slice(0, MAX_TEXT);
  return { title: clip(title, 200), text };
}

const shape = s => ({ id: s.id, targetType: s.target_type, targetId: s.target_id, title: s.title, signer: { name: s.signer_name, email: s.signer_email || null, userId: s.signer_user_id || null },
  status: s.status, hash: s.content_hash, requestedBy: s.requested_by_tag, createdAt: s.created_at, expiresAt: s.expires_at,
  signedName: s.signed_name || null, signedAt: s.signed_at || null, reason: s.decline_reason || null });

async function listFor(db, type, id) {
  return (await db('SELECT * FROM signatures WHERE target_type = ? AND target_id = ? ORDER BY id DESC', [type, id]).catch(() => [])).map(shape);
}

// input: { email, name } or { userId } (a staff member), message (added to the document)
async function request({ db, guildId, type, id, input = {}, actor }) {
  if (require('./demo').DEMO_GUILD_ID === String(guildId)) throw err('Indisponible dans la démonstration', 403);
  if (!TARGETS.includes(type)) throw err('Cible : change, release ou ticket');
  const doc = await documentOf(db, type, id, clip(input.message, 2000).trim());
  if (!doc) throw err('Introuvable', 404);
  if (!doc.text) throw err('Rien à signer : le document est vide');
  let email = null, name = clip(input.name, 100).trim(), userId = null;
  if (input.userId) {
    const [u] = await db("SELECT user_id, username FROM dashboard_users WHERE user_id = ? AND role IN ('support', 'fondateur')", [String(input.userId)]);
    if (!u) throw err('Membre du staff introuvable');
    userId = u.user_id; name = name || u.username;
    const [acc] = await require('./globalDb').globalQuery('SELECT email FROM accounts WHERE id = ? AND email_verified = 1', [userId]).catch(() => []);
    email = acc?.email || null;
    if (!email) throw err('Cette personne n\'a pas d\'adresse e-mail vérifiée');
  } else {
    email = String(input.email || '').trim().toLowerCase();
    if (!require('./emailTickets').EMAIL_RE.test(email) || email.length > 254) throw err('Adresse e-mail invalide');
  }
  if (!name) throw err('Nom de la personne qui signe requis');
  if (!(await require('./instanceMail').mailSettings().catch(() => ({}))).enabled) throw err('L\'e-mail de l\'instance n\'est pas configuré (Instance → Santé)', 409);
  const { allowBurst } = require('./rateLimit');
  if (!(await allowBurst(`sigmail:${guildId}:${actor?.id}`, 10, 3600e3)) || !(await allowBurst(`sigmail:${guildId}`, 30, 3600e3))) throw err('Trop de demandes de signature : réessaie dans une heure', 429);
  const [{ n }] = await db("SELECT COUNT(*) AS n FROM signatures WHERE target_type = ? AND target_id = ? AND status = 'pending'", [type, id]);
  if (Number(n) >= MAX_PENDING) throw err(`${MAX_PENDING} signatures en attente au plus`);
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = sha(`${doc.title}\n\n${doc.text}`);
  const ins = await db(`INSERT INTO signatures (target_type, target_id, title, document, content_hash, signer_name, signer_email, signer_user_id, token_hash, expires_at, requested_by_id, requested_by_tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), ?, ?)`, [type, id, doc.title, doc.text, hash, name, email, userId, sha(token), LINK_DAYS, actor?.id || null, clip(actor?.tag || actor?.username, 100)]);
  const [space] = await require('./globalDb').globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [guildId]).catch(() => []);
  await require('./instanceMail').sendInstanceMail({ to: email, template: 'signatureRequest', lang: require('./i18n').lang(),
    vars: { space: space?.guild_name || 'Support', title: doc.title, by: clip(actor?.tag || actor?.username || 'L\'équipe', 100), link: `${base()}/signature#${token}`, days: LINK_DAYS } });
  await recordEvent(db, { actor, action: 'signature_request', targetType: type, targetId: id, ticketId: type === 'ticket' ? id : undefined, details: { signer: name, hash } });
  return { ok: true, id: ins.insertId };
}

async function findByToken(token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 60) return null;
  const { getTenantDb } = require('./tenantDb');
  const hash = sha(token);
  for (const { guild_id } of await require('./guildScan').getActiveGuilds()) {
    const db = getTenantDb(guild_id);
    const [s] = await db("SELECT * FROM signatures WHERE token_hash = ? AND status = 'pending' AND expires_at > NOW()", [hash]).catch(() => []);
    if (s) return { guildId: guild_id, db, sig: s };
  }
  return null;
}
async function publicView(token) {
  const f = await findByToken(token);
  if (!f) return null;
  const [space] = await require('./globalDb').globalQuery('SELECT guild_name FROM guilds WHERE guild_id = ?', [f.guildId]).catch(() => []);
  return { space: space?.guild_name || 'Support', title: f.sig.title, document: f.sig.document, hash: f.sig.content_hash, signer: f.sig.signer_name, requestedBy: f.sig.requested_by_tag, expiresAt: f.sig.expires_at };
}
// The answer, once: { token, accept, name, reason }
async function answer({ token, accept, name, reason, ip, userAgent }) {
  const f = await findByToken(token);
  if (!f) throw err('Lien invalide, expiré ou déjà utilisé', 404);
  const { db, sig } = f;
  const typed = clip(name, 100).replace(/\s+/g, ' ').trim();
  if (accept) {
    if (typed.length < 2) throw err('Tape ton nom pour signer');
  } else if (!clip(reason, 1000).trim()) throw err('Dis pourquoi tu refuses');
  // Once: the token is spent by the same statement that records the answer
  const r = await db(`UPDATE signatures SET status = ?, signed_name = ?, signed_at = NOW(), signed_ip = ?, signed_ua = ?, decline_reason = ?, token_hash = NULL
    WHERE id = ? AND status = 'pending' AND token_hash = ?`, [accept ? 'signed' : 'declined', typed || null, clip(ip, 45), clip(userAgent, 300), accept ? null : clip(reason, 1000).trim(), sig.id, sha(token)]);
  if (!r.affectedRows) throw err('Lien déjà utilisé', 409);
  const actor = { id: sig.signer_user_id || 'signature', tag: typed || sig.signer_name, username: typed || sig.signer_name, source: 'system' };
  await recordEvent(db, { actor, action: accept ? 'signature_signed' : 'signature_declined', targetType: sig.target_type, targetId: sig.target_id, ticketId: sig.target_type === 'ticket' ? sig.target_id : undefined, details: { signer: typed || sig.signer_name, hash: sig.content_hash } });
  if (sig.target_type === 'ticket') {
    await db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, 'system', ?, ?, 'system')",
      [sig.target_id, clip(sig.signer_name, 100), accept ? `✍️ Livraison signée par ${typed} (empreinte ${sig.content_hash.slice(0, 16)}…)` : `✋ Signature refusée par ${sig.signer_name} : ${clip(reason, 500)}`]).catch(() => null);
  }
  return { ok: true, status: accept ? 'signed' : 'declined' };
}

// Certificate of a signed document (PDF)
async function certificate(db, id) {
  const [s] = await db("SELECT * FROM signatures WHERE id = ? AND status = 'signed'", [id]);
  if (!s) return null;
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Certificat de signature — ${s.title}`, Producer: 'Datick' } });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(res => doc.on('end', res));
  doc.fontSize(18).text('Certificat de signature électronique', { align: 'left' }).moveDown(0.5);
  doc.fontSize(9).fillColor('#555').text('Signature électronique simple (règlement eIDAS, article 25). Ce certificat récapitule ce qui a été signé, par qui et quand.').moveDown();
  doc.fillColor('#000').fontSize(11);
  const row = (k, v) => doc.font('Helvetica-Bold').text(`${k} : `, { continued: true }).font('Helvetica').text(String(v ?? '—'));
  row('Document', s.title);
  row('Signé par', `${s.signed_name} (demandé à ${s.signer_name}${s.signer_email ? `, ${s.signer_email}` : ''})`);
  row('Le', new Date(s.signed_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
  row('Adresse IP', s.signed_ip);
  row('Navigateur', s.signed_ua);
  row('Demandé par', `${s.requested_by_tag || '—'}, le ${new Date(s.created_at).toISOString().slice(0, 10)}`);
  row('Empreinte SHA-256 du document', s.content_hash);
  doc.moveDown().font('Helvetica-Bold').text('Texte signé').moveDown(0.3).font('Helvetica').fontSize(10).text(s.document);
  doc.end();
  await done;
  return { buffer: Buffer.concat(chunks), name: `signature-${s.id}.pdf` };
}

module.exports = { TARGETS, documentOf, listFor, request, findByToken, publicView, answer, certificate, sha };
