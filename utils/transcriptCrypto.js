// Transcripts are stored encrypted (AES-256-GCM, gzipped first) with the secrets key, so they
// follow the same key rotation (scripts/rotate-encryption-key.js). Transcripts written before
// encryption are still read as they are, until the rotation script encrypts them.
const box = require('./secretBox');

const sealTranscript = text => (text == null ? text : box.seal(text, { compress: true }));

function openTranscript(stored) {
  if (stored == null || !box.isSealed(stored)) return stored;
  return box.open(stored);
}

module.exports = { sealTranscript, openTranscript };
