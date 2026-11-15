// Release notes of the site, read from the dashboard's patch notes (the single source).
// Each version also carries its English form (en), used by docs/en/versions.md.
import { VERSIONS, TAG, TAG_EN, localizedVersion } from '../../dashboard/src/data/patchnotes.js';

const withLabels = (v, labels) => ({ ...v, changes: v.changes.map(c => ({ ...c, label: labels(c.type) })) });

export default {
  watch: ['../../dashboard/src/data/patchnotes.js'],
  load() {
    return VERSIONS.map(v => ({
      ...withLabels(v, t => TAG[t]?.label || t),
      en: withLabels(localizedVersion(v, 'en'), t => (v.titleEn ? TAG_EN[t] : TAG[t]?.label) || t),
    }));
  },
};
