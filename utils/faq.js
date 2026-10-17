// Automatic FAQ: before opening a ticket, the member's first message is matched against the
// guild's FAQ entries (keywords + question words). Up to 3 answers are shown in DM with
// "this answers my question" / "open a ticket anyway" buttons.
const STOPWORDS = new Set(('les des une est pas que qui pour dans sur avec mon mes ton tes son ses nous vous ils elles '
  + 'leur leurs mais donc car comme tout tous toute plus moins tres bien fait faire peux peut veux ' +
  'bonjour salut merci svp stp aide aider besoin probleme question cela cette ceci quoi comment pourquoi').split(' '));

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9\s-]/g, ' ');
const tokens = s => norm(s).split(/[\s-]+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));

// Score of an entry for a message: 3 per keyword found, 1 per shared significant word.
function scoreEntry(entry, message) {
  const text = ` ${norm(message).replace(/\s+/g, ' ')} `;
  const words = new Set(tokens(message));
  let score = 0;
  for (const kw of String(entry.keywords || '').split(',').map(k => norm(k).trim()).filter(Boolean)) {
    if (text.includes(` ${kw} `) || (kw.length >= 5 && text.includes(kw))) score += 3;
  }
  for (const w of new Set(tokens(entry.question))) if (words.has(w)) score += 1;
  return score;
}

const MIN_SCORE = 3;

async function findFaqMatches(db, message, limit = 3) {
  if (!message || message.length < 3) return [];
  const entries = await db('SELECT id, question, answer, keywords FROM faq_entries WHERE active = 1').catch(() => []);
  return entries
    .map(e => ({ ...e, score: scoreEntry(e, message) }))
    .filter(e => e.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { findFaqMatches, scoreEntry, MIN_SCORE };
