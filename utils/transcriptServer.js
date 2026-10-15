const { randomUUID } = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const MAX_PAGES = 200; // bounded memory: oldest temporary transcripts are dropped first
const pages = new Map();

function hostTranscript(html) {
  if (pages.size >= MAX_PAGES) {
    const [oldest, page] = pages.entries().next().value;
    clearTimeout(page.timer);
    pages.delete(oldest);
  }
  const token = randomUUID();
  const timer = setTimeout(() => pages.delete(token), TTL_MS);
  pages.set(token, { html, timer });
  return token;
}

function buildUrl(baseUrl, token) {
  return `${baseUrl.replace(/\/$/, '')}/t/${token}`;
}

module.exports = { hostTranscript, buildUrl, pages };
