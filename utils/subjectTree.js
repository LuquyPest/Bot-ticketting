// Ticket subjects as a tree (v4.2): « Facturation » is a category, « Facturation › Remboursement »
// one of its sub-categories (two levels). guild_config.ticket_subjects stays a list of strings, so
// every place that stores or shows a subject keeps working; the existing subjects are categories.
// A sub-category inherits what is set on its category: rules, fields, intake form, procedures,
// teams, deadline (subject_sla), unless it has its own.
const SEP = ' › ';
const MAX_SUBJECTS = 60;
const MAX_ROOTS = 23;       // buttons left on a Discord message once « Other » and « Confidential » are there
const MAX_CHILDREN = 22;    // same, with the « general » button of the category

const parentOf = s => (String(s || '').includes(SEP) ? String(s).split(SEP)[0] : null);
const leafOf = s => String(s || '').split(SEP).pop();
// The subject and its category: most specific first
const lineage = s => (s ? [s, ...(parentOf(s) ? [parentOf(s)] : [])] : []);
const roots = list => list.filter(s => !parentOf(s));
const childrenOf = (list, parent) => list.filter(s => parentOf(s) === parent);

// null or the problem with a list of subjects (Paramètres)
function problem(list) {
  if (!Array.isArray(list) || list.length > MAX_SUBJECTS) return `${MAX_SUBJECTS} sujets au plus`;
  const seen = new Set();
  for (const s of list) {
    if (typeof s !== 'string' || !s.trim() || s.length > 100) return 'Sujet vide ou trop long (100 caractères au plus)';
    if (seen.has(s.toLowerCase())) return `Sujet en double : ${s}`;
    seen.add(s.toLowerCase());
    if (s.split(SEP).length > 2) return `Deux niveaux au plus : ${s}`;
    const p = parentOf(s);
    if (p !== null && (!p.trim() || !leafOf(s).trim())) return `Sous-catégorie incomplète : ${s}`;
    if (p !== null && !list.includes(p)) return `Catégorie absente pour « ${s} » : ajoute d'abord « ${p} »`;
  }
  if (roots(list).length > MAX_ROOTS) return `${MAX_ROOTS} catégories au plus`;
  for (const r of roots(list)) if (childrenOf(list, r).length > MAX_CHILDREN) return `${MAX_CHILDREN} sous-catégories au plus dans « ${r} »`;
  return null;
}

// Deadline of a subject: its own, else its category's (hours, 0 = none)
function subjectSlaHours(map, subject) {
  for (const s of lineage(subject)) { const h = Number(map?.[s]) || 0; if (h > 0) return h; }
  return 0;
}
function slaMapProblem(map, list) {
  if (map === null || map === undefined) return null;
  if (typeof map !== 'object' || Array.isArray(map)) return 'Délais par catégorie invalides';
  for (const [s, h] of Object.entries(map)) {
    if (!list.includes(s)) return `Délai pour un sujet inconnu : ${s.slice(0, 100)}`;
    if (!Number.isInteger(h) || h < 0 || h > 720) return 'Délai par catégorie : un nombre d\'heures entre 0 et 720';
  }
  return null;
}

module.exports = { SEP, MAX_SUBJECTS, parentOf, leafOf, lineage, roots, childrenOf, problem, subjectSlaHours, slaMapProblem };
