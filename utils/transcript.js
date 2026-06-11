function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function fetchAllMessages(channel) {
  const allMessages = [];
  let lastId = null;

  while (true) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {})
    });

    if (!fetched.size) break;

    allMessages.push(...fetched.values());
    lastId = fetched.last().id;

    if (fetched.size < 100) break;
  }

  allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return allMessages;
}

function buildTxtTranscript(channel, messages) {
  let out = `Transcript du salon #${channel.name}\n\n`;

  for (const msg of messages) {
    const date = new Date(msg.createdTimestamp).toLocaleString('fr-FR');
    out += `[${date}] ${msg.author.tag}: ${msg.content || '[aucun texte]'}\n`;

    if (msg.attachments.size > 0) {
      out += `Pièces jointes:\n${[...msg.attachments.values()].map(a => a.url).join('\n')}\n`;
    }

    out += '\n';
  }

  return out;
}

function groupMessages(messages) {
  const groups = [];
  let current = null;

  for (const msg of messages) {
    const gap = current
      ? msg.createdTimestamp - current.messages[current.messages.length - 1].createdTimestamp
      : Infinity;

    if (current && current.authorId === msg.author.id && gap < 5 * 60 * 1000) {
      current.messages.push(msg);
    } else {
      current = { authorId: msg.author.id, messages: [msg] };
      groups.push(current);
    }
  }

  return groups;
}

function renderAttachments(msg) {
  if (!msg.attachments.size) return '';

  const files = [...msg.attachments.values()].map(file => {
    const isImage = file.contentType?.startsWith('image/');
    const isVideo = file.contentType?.startsWith('video/');
    const isAudio = file.contentType?.startsWith('audio/');

    if (isImage) {
      return `<div class="attachment attachment--image">
        <a href="${escapeHtml(file.url)}" target="_blank" rel="noreferrer">
          <img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.name || 'image')}" loading="lazy">
        </a>
      </div>`;
    }
    if (isVideo) {
      return `<div class="attachment attachment--video">
        <video controls preload="metadata">
          <source src="${escapeHtml(file.url)}">
        </video>
      </div>`;
    }
    if (isAudio) {
      return `<div class="attachment attachment--audio">
        <audio controls preload="metadata">
          <source src="${escapeHtml(file.url)}">
        </audio>
        <span class="attachment__name">${escapeHtml(file.name || 'audio')}</span>
      </div>`;
    }
    return `<div class="attachment attachment--file">
      <a href="${escapeHtml(file.url)}" target="_blank" rel="noreferrer" class="attachment__link">
        <svg class="attachment__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>${escapeHtml(file.name || 'Fichier')}</span>
        ${file.size ? `<span class="attachment__size">${formatSize(file.size)}</span>` : ''}
      </a>
    </div>`;
  }).join('');

  return `<div class="attachments">${files}</div>`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function renderGroups(groups) {
  let lastDate = null;
  let html = '';

  for (const group of groups) {
    const first = group.messages[0];
    const author = first.author;
    const avatar = author.displayAvatarURL?.({ size: 64, extension: 'png' }) || `https://cdn.discordapp.com/embed/avatars/0.png`;
    const msgDate = formatDate(first.createdTimestamp);

    if (msgDate !== lastDate) {
      lastDate = msgDate;
      html += `<div class="date-divider"><span>${escapeHtml(msgDate)}</span></div>`;
    }

    const isBot = author.bot;
    const isStaff = first.content?.startsWith('---');

    let groupClass = 'message-group';
    if (isBot) groupClass += ' message-group--bot';
    else if (isStaff) groupClass += ' message-group--staff';

    const lines = group.messages.map((msg, i) => {
      const content = escapeHtml(msg.content || '').replace(/\n/g, '<br>');
      const time = formatTime(msg.createdTimestamp);
      const attachments = renderAttachments(msg);

      return `<div class="message">
        <span class="message__time">${time}</span>
        <div class="message__body">
          ${content ? `<div class="message__content">${content}</div>` : ''}
          ${attachments}
        </div>
      </div>`;
    }).join('');

    html += `<div class="${groupClass}">
      <div class="message-group__avatar">
        <img src="${escapeHtml(avatar)}" alt="${escapeHtml(author.username)}" loading="lazy">
      </div>
      <div class="message-group__content">
        <div class="message-group__header">
          <span class="message-group__author">${escapeHtml(author.tag)}</span>
          ${isBot ? '<span class="badge badge--bot">BOT</span>' : ''}
          ${isStaff && !isBot ? '<span class="badge badge--staff">STAFF</span>' : ''}
          <span class="message-group__date">${formatDate(first.createdTimestamp)} à ${formatTime(first.createdTimestamp)}</span>
        </div>
        ${lines}
      </div>
    </div>`;
  }

  return html;
}

function buildHtmlTranscript(channel, messages, ticketInfo = {}) {
  const generatedAt = new Date().toLocaleString('fr-FR');
  const groups = groupMessages(messages);
  const renderedGroups = renderGroups(groups);
  const expiresIn = 10;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Transcript #${escapeHtml(String(ticketInfo.ticketId || '?'))} — ${escapeHtml(channel.name)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    :root {
      --bg: #0d1117;
      --bg2: #161b22;
      --bg3: #1c2333;
      --border: #30363d;
      --text: #e6edf3;
      --muted: #7d8590;
      --accent: #58a6ff;
      --accent2: #3fb950;
      --staff: #f0883e;
      --bot: #a371f7;
      --danger: #f85149;
      --radius: 12px;
      --shadow: 0 8px 32px rgba(0,0,0,.4);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ── Layout ── */
    .layout { display: flex; min-height: 100vh; }

    .sidebar {
      width: 260px;
      flex-shrink: 0;
      background: var(--bg2);
      border-right: 1px solid var(--border);
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .main { flex: 1; min-width: 0; padding: 24px; max-width: 900px; }

    /* ── Sidebar ── */
    .sidebar-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
      font-size: 16px;
      color: var(--text);
      text-decoration: none;
    }

    .sidebar-logo svg { width: 28px; height: 28px; flex-shrink: 0; }

    .sidebar-section { display: flex; flex-direction: column; gap: 6px; }

    .sidebar-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .08em;
      margin-bottom: 2px;
    }

    .stat-card {
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
    }

    .stat-card__label { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
    .stat-card__value { font-size: 14px; font-weight: 600; color: var(--text); word-break: break-all; }

    .expiry-bar {
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
    }

    .expiry-bar__label { font-size: 11px; color: var(--muted); margin-bottom: 8px; }

    .expiry-bar__track {
      height: 4px;
      background: var(--border);
      border-radius: 99px;
      overflow: hidden;
    }

    .expiry-bar__fill {
      height: 100%;
      background: var(--accent2);
      border-radius: 99px;
      animation: expiry ${expiresIn * 60}s linear forwards;
    }

    @keyframes expiry { from { width: 100%; background: var(--accent2); } to { width: 0%; background: var(--danger); } }

    .expiry-bar__timer {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      margin-top: 8px;
      text-align: right;
    }

    /* ── Header ── */
    .page-header {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px 24px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .page-header__icon {
      width: 44px; height: 44px; flex-shrink: 0;
      background: linear-gradient(135deg, #58a6ff22, #a371f722);
      border: 1px solid var(--border);
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
    }

    .page-header__icon svg { width: 22px; height: 22px; color: var(--accent); }

    .page-header__title { font-size: 18px; font-weight: 700; }
    .page-header__sub { font-size: 13px; color: var(--muted); margin-top: 2px; }

    /* ── Messages ── */
    .messages-container {
      display: flex;
      flex-direction: column;
    }

    .date-divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 20px 0 12px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
    }

    .date-divider::before,
    .date-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    .message-group {
      display: flex;
      gap: 12px;
      padding: 6px 8px;
      border-radius: 8px;
      transition: background .1s;
    }

    .message-group:hover { background: rgba(255,255,255,.03); }

    .message-group--staff .message-group__author { color: var(--staff); }
    .message-group--bot .message-group__author { color: var(--bot); }

    .message-group__avatar {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      margin-top: 2px;
    }

    .message-group__avatar img {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 2px solid var(--border);
      display: block;
    }

    .message-group__content { flex: 1; min-width: 0; }

    .message-group__header {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }

    .message-group__author { font-weight: 700; font-size: 14px; color: var(--text); }
    .message-group__date { font-size: 11px; color: var(--muted); }

    .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: .05em;
    }

    .badge--bot { background: rgba(163,113,247,.2); color: var(--bot); border: 1px solid rgba(163,113,247,.3); }
    .badge--staff { background: rgba(240,136,62,.2); color: var(--staff); border: 1px solid rgba(240,136,62,.3); }

    .message {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin-top: 2px;
    }

    .message__time {
      font-size: 11px;
      color: var(--muted);
      flex-shrink: 0;
      padding-top: 3px;
      width: 36px;
      opacity: 0;
      transition: opacity .1s;
    }

    .message-group:hover .message__time { opacity: 1; }

    .message__body { flex: 1; min-width: 0; }

    .message__content {
      color: var(--text);
      word-break: break-word;
      white-space: pre-wrap;
    }

    /* ── Attachments ── */
    .attachments { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }

    .attachment--image img {
      max-width: min(400px, 100%);
      max-height: 300px;
      border-radius: 8px;
      border: 1px solid var(--border);
      display: block;
      cursor: zoom-in;
    }

    .attachment--video video {
      max-width: min(400px, 100%);
      border-radius: 8px;
      border: 1px solid var(--border);
      display: block;
    }

    .attachment--audio {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .attachment--audio audio { max-width: 300px; }
    .attachment__name { font-size: 13px; color: var(--muted); }

    .attachment--file { display: inline-flex; }

    .attachment__link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 14px;
      color: var(--accent);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: border-color .15s, background .15s;
    }

    .attachment__link:hover { border-color: var(--accent); background: rgba(88,166,255,.06); }
    .attachment__icon { width: 16px; height: 16px; flex-shrink: 0; }
    .attachment__size { color: var(--muted); font-size: 11px; margin-left: 4px; }

    /* ── Footer ── */
    .page-footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--muted);
      font-size: 12px;
    }

    /* ── Empty state ── */
    .empty {
      text-align: center;
      padding: 60px 20px;
      color: var(--muted);
    }

    /* ── Responsive ── */
    @media (max-width: 640px) {
      .sidebar { display: none; }
      .main { padding: 16px; }
    }
  </style>
</head>
<body>
<div class="layout">

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      Transcripts
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Ticket</div>
      <div class="stat-card">
        <div class="stat-card__label">ID</div>
        <div class="stat-card__value">#${escapeHtml(String(ticketInfo.ticketId || '—'))}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Propriétaire</div>
        <div class="stat-card__value">${escapeHtml(ticketInfo.ownerTag || '—')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Créé le</div>
        <div class="stat-card__value">${escapeHtml(ticketInfo.createdAt || '—')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Fermé le</div>
        <div class="stat-card__value">${escapeHtml(ticketInfo.closedAt || 'Non fermé')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Fermé par</div>
        <div class="stat-card__value">${escapeHtml(ticketInfo.closedByTag || '—')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Messages</div>
        <div class="stat-card__value">${messages.length}</div>
      </div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-label">Expiration</div>
      <div class="expiry-bar">
        <div class="expiry-bar__label">Cette page expire dans</div>
        <div class="expiry-bar__track"><div class="expiry-bar__fill"></div></div>
        <div class="expiry-bar__timer" id="timer">10:00</div>
      </div>
    </div>
  </aside>

  <!-- Main -->
  <main class="main">
    <div class="page-header">
      <div class="page-header__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>
      <div>
        <div class="page-header__title">Transcript — #${escapeHtml(channel.name)}</div>
        <div class="page-header__sub">Généré le ${escapeHtml(generatedAt)}</div>
      </div>
    </div>

    <div class="messages-container">
      ${messages.length === 0
        ? `<div class="empty">Aucun message dans ce ticket.</div>`
        : renderedGroups
      }
    </div>

    <div class="page-footer">Transcript généré automatiquement — expire ${expiresIn} minutes après génération</div>
  </main>
</div>

<script>
  // Countdown timer
  const timerEl = document.getElementById('timer');
  let remaining = ${expiresIn * 60};
  function tick() {
    if (remaining <= 0) { timerEl.textContent = 'Expiré'; return; }
    remaining--;
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    timerEl.textContent = m + ':' + s;
    setTimeout(tick, 1000);
  }
  tick();

  // Zoom image au clic
  document.querySelectorAll('.attachment--image img').forEach(img => {
    img.addEventListener('click', () => window.open(img.src, '_blank'));
  });
</script>
</body>
</html>`;
}

const NOTE_PREFIX = require('./notePrefix');

async function buildTranscripts(channel, ticketInfo = {}) {
  const allMessages = await fetchAllMessages(channel);
  // Staff internal notes are excluded from the transcript sent to users
  const messages = allMessages.filter(m => !m.content?.startsWith(NOTE_PREFIX));
  return {
    messageCount: messages.length,
    txt: buildTxtTranscript(channel, messages),
    html: buildHtmlTranscript(channel, messages, ticketInfo)
  };
}

module.exports = { buildTranscripts };
