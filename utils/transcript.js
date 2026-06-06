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

function renderAttachments(msg) {
  if (!msg.attachments.size) return '';

  const files = [...msg.attachments.values()].map(file => {
    const isImage = file.contentType?.startsWith('image/');
    return `
      <div class="attachment">
        <a href="${escapeHtml(file.url)}" target="_blank" rel="noreferrer">
          📎 ${escapeHtml(file.name || 'Fichier')}
        </a>
        ${isImage ? `<div class="image-preview"><img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.name || 'image')}"></div>` : ''}
      </div>
    `;
  }).join('');

  return `<div class="attachments-wrap">${files}</div>`;
}

function buildHtmlTranscript(channel, messages, ticketInfo = {}) {
  const generatedAt = new Date().toLocaleString('fr-FR');

  const rows = messages.map(msg => {
    const date = new Date(msg.createdTimestamp).toLocaleString('fr-FR');
    const content = escapeHtml(msg.content || '[aucun texte]').replace(/\n/g, '<br>');
    const avatarUrl = msg.author.displayAvatarURL({ size: 64, extension: 'png' });
    const avatar = avatarUrl || `https://cdn.discordapp.com/embed/avatars/0.png`;

    return `
      <article class="message-card">
        <div class="avatar">
          <img src="${escapeHtml(avatar)}" alt="avatar">
        </div>
        <div class="message-body">
          <div class="message-top">
            <span class="author">${escapeHtml(msg.author.tag)}</span>
            <span class="date">${escapeHtml(date)}</span>
          </div>
          <div class="message-content">${content}</div>
          ${renderAttachments(msg)}
        </div>
      </article>
    `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Transcript - ${escapeHtml(channel.name)}</title>
  <style>
    :root {
      --bg: #0b0f16;
      --panel: #121826;
      --panel-2: #182132;
      --border: #263247;
      --text: #edf2ff;
      --muted: #9aa8c7;
      --accent: #7c9cff;
      --shadow: 0 10px 30px rgba(0,0,0,0.35);
      --radius: 16px;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 20px;
      background:
        radial-gradient(circle at top left, rgba(124,156,255,0.12), transparent 25%),
        radial-gradient(circle at top right, rgba(94,234,212,0.10), transparent 22%),
        var(--bg);
      color: var(--text);
      font-family: Inter, Arial, sans-serif;
    }
    .container { max-width: 1100px; margin: 0 auto; }
    .header {
      background: linear-gradient(180deg, rgba(124,156,255,0.14), rgba(18,24,38,0.95));
      border: 1px solid var(--border);
      border-radius: 22px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: var(--shadow);
    }
    .badge {
      display: inline-block;
      background: rgba(124,156,255,0.16);
      color: #cdd8ff;
      border: 1px solid rgba(124,156,255,0.25);
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 13px;
      margin-bottom: 14px;
    }
    h1 { margin: 0 0 10px 0; font-size: 30px; }
    .subtitle { color: var(--muted); font-size: 15px; line-height: 1.6; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-top: 18px;
    }
    .stat {
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px 16px;
    }
    .stat-label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .stat-value {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
      word-break: break-word;
    }
    .messages { display: flex; flex-direction: column; gap: 14px; }
    .message-card {
      display: flex;
      gap: 14px;
      background: linear-gradient(180deg, var(--panel), var(--panel-2));
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      box-shadow: var(--shadow);
    }
    .avatar { flex: 0 0 44px; }
    .avatar img {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 1px solid var(--border);
      display: block;
    }
    .message-body { flex: 1; min-width: 0; }
    .message-top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .author { font-weight: 800; font-size: 15px; color: #ffffff; }
    .date { color: var(--muted); font-size: 13px; }
    .message-content {
      background: rgba(255,255,255,0.025);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 12px 14px;
      line-height: 1.7;
      color: var(--text);
      word-break: break-word;
    }
    .attachments-wrap {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 12px;
    }
    .attachment {
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
    }
    .attachment a { color: var(--accent); text-decoration: none; font-weight: 600; }
    .attachment a:hover { text-decoration: underline; }
    .image-preview { margin-top: 10px; }
    .image-preview img {
      max-width: 100%;
      border-radius: 12px;
      border: 1px solid var(--border);
      display: block;
    }
    .footer-note {
      color: var(--muted);
      text-align: center;
      margin-top: 24px;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <section class="header">
      <div class="badge">Transcript HTML</div>
      <h1>Historique du ticket</h1>
      <div class="subtitle">
        Salon Discord : <strong>#${escapeHtml(channel.name)}</strong><br>
        Généré le : <strong>${escapeHtml(generatedAt)}</strong>
      </div>

      <div class="stats">
        <div class="stat"><div class="stat-label">Ticket ID</div><div class="stat-value">${escapeHtml(String(ticketInfo.ticketId || '—'))}</div></div>
        <div class="stat"><div class="stat-label">Propriétaire</div><div class="stat-value">${escapeHtml(ticketInfo.ownerTag || '—')}</div></div>
        <div class="stat"><div class="stat-label">Créé le</div><div class="stat-value">${escapeHtml(ticketInfo.createdAt || '—')}</div></div>
        <div class="stat"><div class="stat-label">Fermé le</div><div class="stat-value">${escapeHtml(ticketInfo.closedAt || 'Non fermé')}</div></div>
        <div class="stat"><div class="stat-label">Fermé par</div><div class="stat-value">${escapeHtml(ticketInfo.closedByTag || 'Inconnu')}</div></div>
        <div class="stat"><div class="stat-label">Messages</div><div class="stat-value">${messages.length}</div></div>
      </div>
    </section>

    <section class="messages">
      ${rows}
    </section>

    <div class="footer-note">Transcript généré automatiquement depuis le salon Discord.</div>
  </div>
</body>
</html>`;
}

async function buildTranscripts(channel, ticketInfo = {}) {
  const messages = await fetchAllMessages(channel);
  return {
    messageCount: messages.length,
    txt: buildTxtTranscript(channel, messages),
    html: buildHtmlTranscript(channel, messages, ticketInfo)
  };
}

module.exports = { buildTranscripts };
