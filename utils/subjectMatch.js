// Accent/case-insensitive subject comparison: "Problème de paiement" matches "paiement".
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[-_]+/g, ' ').trim();

function matchesSubject(a, b) {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

module.exports = { norm, matchesSubject };
