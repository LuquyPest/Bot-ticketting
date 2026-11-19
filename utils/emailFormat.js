// E-mails that look like e-mails (v5.0, conception/v5.md §3.14): what the staff writes (Discord
// markdown: **bold**, *italic*, __underline__, ~~strike~~, `code`, ```blocks```, [links](https://…),
// lists, > quotes) becomes HTML, in a template with the space's name, logo and colour, followed by
// the signatures. Safe by construction: everything is escaped first, then only these patterns
// turn into tags — no HTML written by anyone ever reaches an e-mail. Links: http(s) and mailto only.
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const SAFE_URL = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"'@]+@[^\s<>"']+)$/i;

const dateOf = t => new Date(Number(t) * 1000).toLocaleString('fr-FR');

// Inline markdown of one escaped line
function inline(escaped) {
  const slots = [];
  const keep = html => `\u0000${slots.push(html) - 1}\u0000`;
  let s = escaped
    .replace(/`([^`\n]+)`/g, (m, c) => keep(`<code style="font-family:ui-monospace,monospace;background:#f1f2f6;padding:1px 4px;border-radius:4px">${c}</code>`))
    .replace(/&lt;t:(\d{1,12})(?::\w)?&gt;/g, (m, t) => dateOf(t))
    // ![text](/api/kb/<space>/images/<token>): an image of a knowledge base article (v6), only that path
    .replace(/!\[([^\]\n]{0,200})\]\((\/api\/kb\/\d{17,20}\/images\/[0-9a-f]{32})\)/g, (m, alt, p) => keep(`<img src="${escapeHtml(`${(require('./config').config.webServerBaseUrl || '').replace(/\/$/, '')}${p}`)}" alt="${alt}" style="max-width:100%;height:auto;border-radius:8px">`))
    // [text](url): the URL was escaped with the rest; it is checked again before becoming a link
    .replace(/\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g, (m, text, url) => {
      const raw = url.replace(/&amp;/g, '&');
      return SAFE_URL.test(raw) ? keep(`<a href="${escapeHtml(raw)}" style="color:inherit">${text}</a>`) : m;
    })
    .replace(/(^|[\s(])(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])/g, (m, pre, url) => {
      const raw = url.replace(/&amp;/g, '&');
      return SAFE_URL.test(raw) ? `${pre}${keep(`<a href="${escapeHtml(raw)}" style="color:inherit">${url}</a>`)}` : m;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<u>$1</u>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => slots[Number(i)]);
}

// A block of markdown → HTML (paragraphs, lists, quotes, code blocks)
function markdownToHtml(md) {
  const text = String(md || '').replace(/\r\n/g, '\n');
  const out = [];
  const parts = text.split(/```/);
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) { // inside a code block
      out.push(`<pre style="font-family:ui-monospace,monospace;background:#f1f2f6;padding:10px 12px;border-radius:8px;white-space:pre-wrap;margin:0 0 12px">${escapeHtml(part.replace(/^\w*\n/, ''))}</pre>`);
      return;
    }
    for (const para of part.split(/\n{2,}/)) {
      // Consecutive lines of the same kind form one block: a list may follow a line of text
      const kindOf = l => (/^\s*[-*•]\s+/.test(l) ? 'ul' : /^\s*\d+[.)]\s+/.test(l) ? 'ol' : /^\s*>/.test(l) ? 'quote' : 'p');
      const groups = [];
      for (const l of para.split('\n')) {
        if (!l.trim()) continue;
        const k = kindOf(l);
        if (groups.length && groups[groups.length - 1].k === k) groups[groups.length - 1].lines.push(l);
        else groups.push({ k, lines: [l] });
      }
      for (const { k, lines } of groups) {
        if (k === 'ul') out.push(`<ul style="margin:0 0 12px;padding-left:20px">${lines.map(l => `<li>${inline(escapeHtml(l.replace(/^\s*[-*•]\s+/, '')))}</li>`).join('')}</ul>`);
        else if (k === 'ol') out.push(`<ol style="margin:0 0 12px;padding-left:20px">${lines.map(l => `<li>${inline(escapeHtml(l.replace(/^\s*\d+[.)]\s+/, '')))}</li>`).join('')}</ol>`);
        else if (k === 'quote') out.push(`<blockquote style="margin:0 0 12px;padding:2px 12px;border-left:3px solid #d6d9e0;color:#5d6478">${lines.map(l => inline(escapeHtml(l.replace(/^\s*>\s?/, '')))).join('<br>')}</blockquote>`);
        else out.push(`<p style="margin:0 0 12px">${lines.map(l => {
          const h = /^\s*#{1,3}\s+(.*)$/.exec(l);
          return h ? `<strong>${inline(escapeHtml(h[1]))}</strong>` : inline(escapeHtml(l));
        }).join('<br>')}</p>`);
      }
    }
  });
  return out.join('');
}

// Plain text version: markdown marks removed, links as « text (url) »
function markdownToText(md) {
  return require('./kbImages').toLinks(String(md || ''))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/~~(.+?)~~/g, '$1')
    .replace(/```\w*\n?/g, '').replace(/`([^`\n]+)`/g, '$1')
    .replace(/<t:(\d+)(?::\w)?>/g, (m, t) => dateOf(t));
}

// brand: { name, logo, color, footer } — logo only an https URL, colour only #rrggbb
function wrapHtml(bodyHtml, brand = {}) {
  const color = COLOR_RE.test(brand.color || '') ? brand.color : '#5865f2';
  const logo = /^https:\/\/[^\s"'<>]+$/.test(brand.logo || '') ? brand.logo : null;
  const name = escapeHtml(brand.name || 'Support');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border-top:4px solid ${color};overflow:hidden">
<tr><td style="padding:18px 24px 6px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;font-weight:700;color:#1f2330">${logo ? `<img src="${escapeHtml(logo)}" alt="" height="28" style="height:28px;vertical-align:middle;border-radius:6px;margin-right:8px">` : ''}${name}</td></tr>
<tr><td style="padding:10px 24px 18px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.55;color:#1f2330">${bodyHtml}</td></tr>
${brand.footer ? `<tr><td style="padding:12px 24px 18px;border-top:1px solid #eceef3;font-family:system-ui,sans-serif;font-size:12px;color:#7a8194">${escapeHtml(brand.footer)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}

const SIGNATURE_MAX = 1000;
const cleanSignature = s => (typeof s === 'string' ? s.replace(/\r\n/g, '\n').trim().slice(0, SIGNATURE_MAX) : '');

module.exports = { escapeHtml, markdownToHtml, markdownToText, wrapHtml, cleanSignature, SIGNATURE_MAX };
