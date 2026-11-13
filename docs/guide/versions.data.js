// Release notes of the site, read from the dashboard's patch notes (the single source)
import { VERSIONS, TAG } from '../../dashboard/src/data/patchnotes.js';

export default {
  watch: ['../../dashboard/src/data/patchnotes.js'],
  load() {
    return VERSIONS.map(v => ({ ...v, changes: v.changes.map(c => ({ ...c, label: TAG[c.type]?.label || c.type })) }));
  },
};
