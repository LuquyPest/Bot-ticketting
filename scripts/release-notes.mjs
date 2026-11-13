// Prints the GitHub release notes of a version from the dashboard patchnotes (the one source).
//   node scripts/release-notes.mjs v2.24 [ghcr.io/owner/repo]
import { VERSIONS, TAG } from '../dashboard/src/data/patchnotes.js';

const [tag, image = 'ghcr.io/luquypest/bot-ticketting'] = process.argv.slice(2);
if (!tag) { console.error('Usage : node scripts/release-notes.mjs vX.Y [image]'); process.exit(1); }
const version = VERSIONS.find(v => v.version === tag);
if (!version) { console.error(`Version ${tag} absente de dashboard/src/data/patchnotes.js`); process.exit(1); }

const lines = [`## ${version.title}`, '', `_${version.date}_`, ''];
for (const c of version.changes) lines.push(`- **${TAG[c.type]?.label || c.type}** — ${c.text}`);
lines.push('', '### Mise à jour', '', '```bash', `docker compose pull && docker compose up -d`, '```', '',
  `Image : \`${image}:${tag}\` (aussi \`latest\`). Les migrations de base de données s'appliquent au démarrage — voir [Mises à jour](https://daryu.xyz/guide/mise-a-jour).`);
console.log(lines.join('\n'));
