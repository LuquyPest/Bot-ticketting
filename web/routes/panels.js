const express = require('express');
const router = express.Router();
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { logAudit } = require('../../utils/gradePermissions');

const STYLE_MAP = {
  primary:   ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success:   ButtonStyle.Success,
  danger:    ButtonStyle.Danger,
};

function hexToInt(hex) {
  return parseInt((hex || '#6366f1').replace('#', ''), 16);
}

async function buildDiscordEmbed(panel) {
  const embed = new EmbedBuilder()
    .setTitle(panel.title || 'Support')
    .setColor(hexToInt(panel.color));
  if (panel.description) embed.setDescription(panel.description);
  if (panel.footer_text) embed.setFooter({ text: panel.footer_text });
  if (panel.image_url)   embed.setImage(panel.image_url);
  return embed;
}

function buildDiscordComponents(buttons) {
  if (!buttons.length) return [];
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const chunk = buttons.slice(i, i + 5);
    const row = new ActionRowBuilder();
    for (const btn of chunk) {
      const b = new ButtonBuilder()
        .setCustomId(`panel_btn_${btn.id}`)
        .setLabel(btn.label)
        .setStyle(STYLE_MAP[btn.style] || ButtonStyle.Primary);
      if (btn.emoji) b.setEmoji(btn.emoji);
      row.addComponents(b);
    }
    rows.push(row);
  }
  return rows;
}

// GET /api/panels
router.get('/', async (req, res) => {
  try {
    const panels = await req.guildDb('SELECT * FROM ticket_panels ORDER BY id DESC');
    for (const p of panels) {
      p.buttons = await req.guildDb('SELECT * FROM panel_buttons WHERE panel_id = ? ORDER BY position ASC', [p.id]);
    }
    res.json(panels);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/panels
router.post('/', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  const { name, title, description, color, footer_text, image_url, buttons = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });
  try {
    const r = await req.guildDb(
      'INSERT INTO ticket_panels (name, title, description, color, footer_text, image_url) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), title || 'Support', description || null, color || '#6366f1', footer_text || null, image_url || null]
    );
    const panelId = r.insertId;
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      await req.guildDb(
        'INSERT INTO panel_buttons (panel_id, label, emoji, style, subject, form_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [panelId, b.label, b.emoji || null, b.style || 'primary', b.subject || null, b.form_id || null, i]
      );
    }
    await logAudit(req.session.user.id, req.session.user.username, 'panel_create', 'panel', panelId, { name }, req.guildDb);
    const [panel] = await req.guildDb('SELECT * FROM ticket_panels WHERE id = ?', [panelId]);
    panel.buttons = await req.guildDb('SELECT * FROM panel_buttons WHERE panel_id = ? ORDER BY position ASC', [panelId]);
    res.status(201).json(panel);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/panels/:id
router.patch('/:id', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  const { name, title, description, color, footer_text, image_url, buttons } = req.body;
  try {
    const [panel] = await req.guildDb('SELECT * FROM ticket_panels WHERE id = ?', [req.params.id]);
    if (!panel) return res.status(404).json({ error: 'Panel introuvable' });

    await req.guildDb(
      'UPDATE ticket_panels SET name=?, title=?, description=?, color=?, footer_text=?, image_url=? WHERE id=?',
      [
        name ?? panel.name,
        title ?? panel.title,
        description !== undefined ? (description || null) : panel.description,
        color ?? panel.color,
        footer_text !== undefined ? (footer_text || null) : panel.footer_text,
        image_url   !== undefined ? (image_url   || null) : panel.image_url,
        panel.id,
      ]
    );

    if (Array.isArray(buttons)) {
      await req.guildDb('DELETE FROM panel_buttons WHERE panel_id = ?', [panel.id]);
      for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        await req.guildDb(
          'INSERT INTO panel_buttons (panel_id, label, emoji, style, subject, form_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [panel.id, b.label, b.emoji || null, b.style || 'primary', b.subject || null, b.form_id || null, i]
        );
      }
    }

    await logAudit(req.session.user.id, req.session.user.username, 'panel_update', 'panel', panel.id, { name }, req.guildDb);
    const [updated] = await req.guildDb('SELECT * FROM ticket_panels WHERE id = ?', [panel.id]);
    updated.buttons = await req.guildDb('SELECT * FROM panel_buttons WHERE panel_id = ? ORDER BY position ASC', [panel.id]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/panels/:id
router.delete('/:id', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  try {
    const [panel] = await req.guildDb('SELECT * FROM ticket_panels WHERE id = ?', [req.params.id]);
    if (!panel) return res.status(404).json({ error: 'Panel introuvable' });

    if (panel.message_id && panel.channel_id) {
      const client = req.app.get('botClient');
      if (client?.isReady()) {
        const ch = await client.channels.fetch(panel.channel_id).catch(() => null);
        if (ch) await ch.messages.delete(panel.message_id).catch(() => null);
      }
    }

    await req.guildDb('DELETE FROM ticket_panels WHERE id = ?', [panel.id]);
    await logAudit(req.session.user.id, req.session.user.username, 'panel_delete', 'panel', panel.id, { name: panel.name }, req.guildDb);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/panels/:id/publish — poste ou met à jour le message Discord
router.post('/:id/publish', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  const { channel_id } = req.body;
  if (!channel_id) return res.status(400).json({ error: 'channel_id requis' });

  const client = req.app.get('botClient');
  if (!client?.isReady()) return res.status(503).json({ error: 'Bot non connecté' });

  try {
    const [panel] = await req.guildDb('SELECT * FROM ticket_panels WHERE id = ?', [req.params.id]);
    if (!panel) return res.status(404).json({ error: 'Panel introuvable' });

    const buttons = await req.guildDb('SELECT * FROM panel_buttons WHERE panel_id = ? ORDER BY position ASC', [panel.id]);
    const embed = await buildDiscordEmbed(panel);
    const components = buildDiscordComponents(buttons);
    const payload = { embeds: [embed], components };

    const ch = await client.channels.fetch(channel_id).catch(() => null);
    if (!ch?.isTextBased()) return res.status(400).json({ error: 'Salon introuvable ou invalide' });

    let messageId = panel.message_id;

    if (messageId && panel.channel_id === channel_id) {
      const existing = await ch.messages.fetch(messageId).catch(() => null);
      if (existing) {
        await existing.edit(payload);
      } else {
        const msg = await ch.send(payload);
        messageId = msg.id;
      }
    } else {
      if (panel.message_id && panel.channel_id) {
        const oldCh = await client.channels.fetch(panel.channel_id).catch(() => null);
        if (oldCh) await oldCh.messages.delete(panel.message_id).catch(() => null);
      }
      const msg = await ch.send(payload);
      messageId = msg.id;
    }

    await req.guildDb(
      'UPDATE ticket_panels SET channel_id = ?, message_id = ? WHERE id = ?',
      [channel_id, messageId, panel.id]
    );

    await logAudit(req.session.user.id, req.session.user.username, 'panel_publish', 'panel', panel.id, { channel_id }, req.guildDb);
    res.json({ ok: true, message_id: messageId, channel_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// DELETE /api/panels/:id/publish — retire le message Discord
router.delete('/:id/publish', async (req, res) => {
  if (!req.userIsFondateur) return res.status(403).json({ error: 'Réservé au fondateur' });
  try {
    const [panel] = await req.guildDb('SELECT * FROM ticket_panels WHERE id = ?', [req.params.id]);
    if (!panel) return res.status(404).json({ error: 'Panel introuvable' });

    if (panel.message_id && panel.channel_id) {
      const client = req.app.get('botClient');
      if (client?.isReady()) {
        const ch = await client.channels.fetch(panel.channel_id).catch(() => null);
        if (ch) await ch.messages.delete(panel.message_id).catch(() => null);
      }
      await req.guildDb('UPDATE ticket_panels SET channel_id = NULL, message_id = NULL WHERE id = ?', [panel.id]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
