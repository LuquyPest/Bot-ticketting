// Operators typed in the ticket search box, e.g. « tag:VIP de:pseudo avant:2026-10-01 étape:attente
// remboursement ». Keys and values ignore accents and case; a value with spaces goes in quotes
// (tag:"Très urgent"). Words that are not operators search the subject, as before.
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const KEYS = {
  tag: 'tag', etiquette: 'tag',
  de: 'from', par: 'from', membre: 'from', from: 'from', auteur: 'from',
  avant: 'before', before: 'before', jusqua: 'before',
  apres: 'after', after: 'after', depuis: 'after',
  etape: 'stage', stage: 'stage',
  priorite: 'priority', prio: 'priority', priority: 'priority',
  statut: 'status', status: 'status', etat: 'status',
  assigne: 'assignee', assignee: 'assignee', pour: 'assignee',
  sujet: 'subject', subject: 'subject', titre: 'subject',
};
const VALUES = {
  stage: { ouvert: 'open', open: 'open', attente: 'waiting', 'en attente': 'waiting', waiting: 'waiting', cours: 'in_progress', 'en cours': 'in_progress', in_progress: 'in_progress' },
  priority: { faible: 'low', basse: 'low', low: 'low', normale: 'normal', normal: 'normal', urgente: 'urgent', urgent: 'urgent', haute: 'urgent' },
  status: { ouvert: 'open', ouverts: 'open', open: 'open', ferme: 'closed', fermes: 'closed', closed: 'closed' },
};
const LABELS = { stage: 'étape', priority: 'priorité', status: 'statut', before: 'avant', after: 'après' };

// YYYY-MM-DD or DD/MM/YYYY → YYYY-MM-DD (null when invalid)
function parseDate(v) {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) { const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v); if (fr) m = [null, fr[3], fr[2].padStart(2, '0'), fr[1].padStart(2, '0')]; }
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3]) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

// Returns { text, filters: { tag: [], from: [], subject: [], before, after, stage, priority, status, assignee }, error }
function parseSearch(input) {
  const filters = { tag: [], from: [], subject: [] };
  const words = [];
  const re = /(\S+?):(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(input || '').slice(0, 300)))) {
    const key = m[1] !== undefined ? KEYS[norm(m[1])] : null;
    if (!key) { words.push(m[1] !== undefined ? m[0] : (m[4] ?? m[5])); continue; }
    const raw = (m[2] ?? m[3] ?? '').trim();
    if (!raw) continue;
    if (key === 'tag' || key === 'from' || key === 'subject') { filters[key].push(raw.slice(0, 100)); continue; }
    if (key === 'before' || key === 'after') {
      const d = parseDate(raw);
      if (!d) return { error: `Date invalide pour « ${LABELS[key]} » : ${raw} (format 2026-10-01 ou 01/10/2026)` };
      filters[key] = d;
      continue;
    }
    if (key === 'assignee') { filters.assignee = raw.slice(0, 100); continue; }
    const v = VALUES[key][norm(raw).replace(/_/g, ' ')] || VALUES[key][norm(raw)];
    if (!v) return { error: `Valeur inconnue pour « ${LABELS[key]} » : ${raw}` };
    filters[key] = v;
  }
  return { text: words.join(' ').trim(), filters, error: null };
}

const hasOperators = f => f.tag.length || f.from.length || f.subject.length || f.before || f.after || f.stage || f.priority || f.status || f.assignee;

module.exports = { parseSearch, parseDate, hasOperators };
