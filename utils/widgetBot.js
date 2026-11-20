// Question tree in front of the widget (v7, conception/v7.md §3.7) — no AI: steps written by the
// team. Each step has a message and buttons; a button goes to another step, opens a public article
// of the knowledge base, or hands over to a person (the live chat when someone is available, else
// the form) or to the form. « Talk to someone » is always offered. The path the visitor took is
// added to the ticket, so the staff knows what was already tried.
const { parseJsonField } = require('./jsonField');

const MAX_NODES = 50, MAX_BUTTONS = 6;
const KINDS = ['step', 'article', 'human', 'form'];
const ID_RE = /^[a-z0-9_-]{1,20}$/;

async function getBot(db) {
  const [c] = await db('SELECT widget_bot FROM guild_config WHERE id = 1').catch(() => []);
  const b = parseJsonField(c?.widget_bot, null);
  return b && typeof b === 'object' ? { enabled: !!b.enabled, start: b.start || null, nodes: Array.isArray(b.nodes) ? b.nodes : [] } : { enabled: false, start: null, nodes: [] };
}
function clean(input = {}) {
  const raw = Array.isArray(input.nodes) ? input.nodes : [];
  if (raw.length > MAX_NODES) return { error: `${MAX_NODES} étapes au plus` };
  const nodes = [];
  for (const n of raw) {
    const id = String(n?.id || '');
    if (!ID_RE.test(id)) return { error: 'Identifiant d\'étape invalide' };
    if (nodes.some(x => x.id === id)) return { error: `Deux étapes ont l'identifiant « ${id} »` };
    const text = typeof n.text === 'string' ? n.text.trim().slice(0, 1000) : '';
    if (!text) return { error: 'Chaque étape a un message' };
    const buttons = [];
    for (const b of (Array.isArray(n.buttons) ? n.buttons : []).slice(0, MAX_BUTTONS)) {
      const label = typeof b?.label === 'string' ? b.label.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      if (!label) return { error: `Un bouton de l'étape « ${id} » n'a pas de texte` };
      if (!KINDS.includes(b.kind)) return { error: `Bouton « ${label} » : type inconnu` };
      const btn = { label, kind: b.kind };
      if (b.kind === 'step') btn.next = String(b.next || '');
      if (b.kind === 'article') { btn.articleId = Number(b.articleId); if (!Number.isInteger(btn.articleId) || btn.articleId <= 0) return { error: `Bouton « ${label} » : choisis un article` }; }
      buttons.push(btn);
    }
    nodes.push({ id, text, buttons });
  }
  for (const n of nodes) for (const b of n.buttons) if (b.kind === 'step' && !nodes.some(x => x.id === b.next)) return { error: `Bouton « ${b.label} » : étape « ${b.next} » introuvable` };
  const start = nodes.length ? (nodes.some(x => x.id === input.start) ? input.start : nodes[0].id) : null;
  if (input.enabled && !nodes.length) return { error: 'Ajoute au moins une étape' };
  return { value: { enabled: !!input.enabled && nodes.length > 0, start, nodes } };
}
async function saveBot(db, input) {
  const r = clean(input);
  if (r.error) return r;
  const ids = [...new Set(r.value.nodes.flatMap(n => n.buttons.filter(b => b.kind === 'article').map(b => b.articleId)))];
  if (ids.length) {
    const kb = require('./knowledgeBase');
    const found = await db(`SELECT id FROM faq_entries WHERE id IN (?) AND visibility = 'public' AND ${kb.LIVE}`, [ids]).catch(() => []);
    if (found.length !== ids.length) return { error: 'Un bouton mène à un article qui n\'est pas public ou pas publié' };
  }
  await db('UPDATE guild_config SET widget_bot = ? WHERE id = 1', [JSON.stringify(r.value)]);
  return { ok: true };
}
// What the widget receives: the tree with the articles' public addresses (only if published)
async function publicTree(db, guildId) {
  const b = await getBot(db);
  if (!b.enabled || !b.nodes.length) return null;
  const kb = require('./knowledgeBase');
  const kbOn = await kb.kbEnabled(db).catch(() => false);
  const nodes = b.nodes.map(n => ({ id: n.id, text: n.text, buttons: n.buttons.filter(x => x.kind !== 'article' || kbOn).map(x => (x.kind === 'article' ? { label: x.label, kind: 'article', url: kb.kbUrl(guildId, x.articleId) } : x)) }));
  return { start: b.start, nodes };
}
// The path, written by the widget (« Livraison › Colis en retard »), cleaned before it joins the ticket
const cleanPath = p => (typeof p === 'string' ? p.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : '');

module.exports = { MAX_NODES, KINDS, getBot, saveBot, publicTree, cleanPath, clean };
