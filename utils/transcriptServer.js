const { randomUUID } = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const pages = new Map();

function hostTranscript(html) {
  const token = randomUUID();
  const timer = setTimeout(() => pages.delete(token), TTL_MS);
  pages.set(token, { html, timer });
  return token;
}

function buildUrl(baseUrl, token) {
  return `${baseUrl.replace(/\/$/, '')}/t/${token}`;
}

module.exports = { hostTranscript, buildUrl, pages };
