// Accent/case-insensitive subject comparison: "Problème de paiement" matches "paiement".
// matchesSubject(rule, subject) — the rule's subject first (rules, procedures, templates,
// incidents). Categories in a tree (utils/subjectTree.js): a rule on a category applies to its
// sub-categories (« Facturation » ⊂ « Facturation › Remboursement »), never the other way: a rule
// on a sub-category applies to it only.
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[-_]+/g, ' ').trim();
const SEP = '›';

function matchesSubject(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x.includes(SEP)) return x === y;
  // A sub-category is compared through its category and its own name, not the whole path
  if (y.includes(SEP)) return y.split(SEP).map(p => p.trim()).some(p => p && (p.includes(x) || x.includes(p)));
  return x.includes(y) || y.includes(x);
}

module.exports = { norm, matchesSubject };
