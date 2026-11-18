// Prints the GitHub release notes of a version from the dashboard patchnotes (the one source):
// English first when the version has its translation, then French.
//   node scripts/release-notes.mjs v2.24 [ghcr.io/owner/repo]
import { VERSIONS, TAG, TAG_EN, localizedVersion } from '../dashboard/src/data/patchnotes.js';

const [tag, image = 'ghcr.io/luquypest/datick'] = process.argv.slice(2);
if (!tag) { console.error('Usage : node scripts/release-notes.mjs vX.Y [image]'); process.exit(1); }
const version = VERSIONS.find(v => v.version === tag);
if (!version) { console.error(`Version ${tag} absente de dashboard/src/data/patchnotes.js`); process.exit(1); }

const lines = [];
if (version.titleEn) {
  const en = localizedVersion(version, 'en');
  lines.push(`## ${en.title}`, '', `_${en.date}_`, '');
  for (const c of en.changes) lines.push(`- **${TAG_EN[c.type] || c.type}** — ${c.text}`);
  lines.push('', '### Update', '', '```bash', 'docker compose pull && docker compose up -d', '```', '',
    `Image: \`${image}:${tag}\` (also \`latest\`). Database migrations apply at startup — see [Updates](https://docs.bot.daryu.xyz/en/updates).`,
    '', '<details><summary>En français</summary>', '');
}
lines.push(`## ${version.title}`, '', `_${version.date}_`, '');
for (const c of version.changes) lines.push(`- **${TAG[c.type]?.label || c.type}** — ${c.text}`);
lines.push('', '### Mise à jour', '', '```bash', `docker compose pull && docker compose up -d`, '```', '',
  `Image : \`${image}:${tag}\` (aussi \`latest\`). Les migrations de base de données s'appliquent au démarrage — voir [Mises à jour](https://docs.bot.daryu.xyz/guide/mise-a-jour).`);
if (version.titleEn) lines.push('', '</details>');
console.log(lines.join('\n'));
