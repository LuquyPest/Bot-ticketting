// Monthly report (PDF): volume, response times, per-stage SLA compliance, satisfaction, staff
// ranking, top subjects. Downloadable from the dashboard, and posted on the 1st of each month in
// the channel set in the settings (BullMQ job 'monthly-report').
const PDFDocument = require('pdfkit');
const { stageCompliance, median, avg } = require('./stageStats');
const logger = require('./logger');

const STAGE_NAME = { open: 'Ouvert', waiting: 'En attente', in_progress: 'En cours' };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const previousMonth = (now = new Date()) => {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; };
const fmtMin = m => {
  if (m == null) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${Math.floor(h / 24)} j ${h % 24} h`;
};

async function computeMonthlyStats(db, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Object.assign(new Error('Mois invalide (AAAA-MM)'), { status: 400 });
  const from = `${month}-01 00:00:00`;
  const [y, mo] = month.split('-').map(Number);
  const to = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01 00:00:00`;
  const range = [from, to];

  const [[counts], daily, fr, [cfg], ratings, staff, subjects] = await Promise.all([
    db(`SELECT SUM(created_at >= ? AND created_at < ?) AS opened, SUM(closed_at >= ? AND closed_at < ?) AS closed FROM tickets`, [...range, ...range]),
    db(`SELECT DAY(created_at) AS d, COUNT(*) AS n FROM tickets WHERE created_at >= ? AND created_at < ? GROUP BY d`, range),
    db(`SELECT TIMESTAMPDIFF(MINUTE, created_at, first_response_at) AS m FROM tickets WHERE created_at >= ? AND created_at < ?`, range),
    db('SELECT sla_open_hours, sla_waiting_hours, sla_in_progress_hours FROM guild_config WHERE id = 1'),
    db('SELECT rating, COUNT(*) AS n FROM ticket_ratings WHERE rated_at >= ? AND rated_at < ? GROUP BY rating', range),
    db(`SELECT t.closed_by_id AS id, COALESCE(u.username, MAX(t.closed_by_tag)) AS name, COUNT(*) AS closed,
               (SELECT ROUND(AVG(r.rating), 1) FROM ticket_ratings r WHERE r.closed_by_id = t.closed_by_id AND r.rated_at >= ? AND r.rated_at < ?) AS rating
        FROM tickets t LEFT JOIN dashboard_users u ON u.user_id = t.closed_by_id
        WHERE t.closed_at >= ? AND t.closed_at < ? AND t.closed_by_id IS NOT NULL
        GROUP BY t.closed_by_id, u.username ORDER BY closed DESC LIMIT 10`, [...range, ...range]),
    db(`SELECT COALESCE(subject, 'Sans sujet') AS subject, COUNT(*) AS n FROM tickets WHERE created_at >= ? AND created_at < ? GROUP BY subject ORDER BY n DESC LIMIT 8`, range),
  ]);

  const answered = fr.filter(r => r.m !== null).map(r => Math.max(0, Number(r.m)));
  const slaMin = { open: (cfg?.sla_open_hours || 0) * 60, waiting: (cfg?.sla_waiting_hours || 0) * 60, in_progress: (cfg?.sla_in_progress_hours || 0) * 60 };
  const stageTickets = await db('SELECT id, created_at, closed_at FROM tickets WHERE created_at < ? AND (closed_at IS NULL OR closed_at >= ?) LIMIT 5000', [to, from]);
  const end = Math.min(Date.now(), new Date(to.replace(' ', 'T')).getTime());
  const distribution = [1, 2, 3, 4, 5].map(rating => ({ rating, n: Number(ratings.find(r => r.rating === rating)?.n || 0) }));
  const totalRatings = distribution.reduce((a, d) => a + d.n, 0);
  const daysInMonth = new Date(y, mo, 0).getDate();

  return {
    month, label: monthLabel(month),
    opened: Number(counts?.opened || 0), closed: Number(counts?.closed || 0),
    daily: Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, n: Number(daily.find(d => d.d === i + 1)?.n || 0) })),
    firstResponse: {
      answered: answered.length, unanswered: fr.length - answered.length, medianMinutes: median(answered), avgMinutes: avg(answered),
      within1h: answered.length ? Math.round((answered.filter(m => m <= 60).length / answered.length) * 100) : null,
    },
    stages: await stageCompliance(db, stageTickets, slaMin, end),
    satisfaction: {
      total: totalRatings, distribution,
      average: totalRatings ? Math.round((distribution.reduce((a, d) => a + d.rating * d.n, 0) / totalRatings) * 10) / 10 : null,
    },
    staff: staff.map(s => ({ name: s.name || s.id, closed: Number(s.closed), rating: s.rating != null ? Number(s.rating) : null })),
    subjects: subjects.map(s => ({ subject: s.subject, n: Number(s.n) })),
  };
}

// PDF rendering (pdfkit, standard fonts: Latin accents supported, no emoji)
function renderReportPdf(stats, guildName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Rapport ${stats.label} — ${guildName}` } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const INK = '#14142a', MUTED = '#6b6b85', ACCENT = '#2a78d6', LINE = '#e3e3ee';
    const W = doc.page.width - 96;
    // pdfkit keeps the x of the last positioned text: every block restarts at the left margin
    const h2 = t => { doc.moveDown(1.2).fillColor(INK).font('Helvetica-Bold').fontSize(13).text(t, 48, doc.y, { width: W }); doc.moveDown(0.4); };
    const para = (t, color = INK) => doc.font('Helvetica').fontSize(10).fillColor(color).text(t, 48, doc.y, { width: W });
    const row = (cells, widths, bold = false) => {
      const y = doc.y;
      let x = 48;
      cells.forEach((c, i) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(bold ? MUTED : INK).text(String(c), x, y, { width: widths[i] - 6 }); x += widths[i]; });
      doc.moveTo(48, doc.y + 3).lineTo(48 + W, doc.y + 3).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.y += 6;
    };

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(`Rapport mensuel — ${stats.label}`);
    doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(guildName);

    // Key figures
    doc.moveDown(1);
    const kpis = [
      ['Tickets ouverts', stats.opened], ['Tickets fermés', stats.closed],
      ['Première réponse (médiane)', fmtMin(stats.firstResponse.medianMinutes)],
      ['Satisfaction', stats.satisfaction.average != null ? `${stats.satisfaction.average} / 5` : '—'],
    ];
    const kw = W / 4, ky = doc.y;
    kpis.forEach(([label, value], i) => {
      const x = 48 + i * kw;
      doc.roundedRect(x, ky, kw - 8, 54, 6).fillColor('#f4f4fa').fill();
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(label, x + 8, ky + 8, { width: kw - 24 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(String(value), x + 8, ky + 26, { width: kw - 24 });
    });
    doc.y = ky + 66;

    // Daily volume (bars, labelled scale)
    h2('Tickets ouverts par jour');
    const chartH = 90, top = doc.y, max = Math.max(1, ...stats.daily.map(d => d.n));
    const bw = W / stats.daily.length;
    stats.daily.forEach((d, i) => {
      const h = (d.n / max) * chartH;
      if (h > 0) doc.rect(48 + i * bw + 1, top + chartH - h, Math.max(1, bw - 2), h).fillColor(ACCENT).fill();
      if ((i + 1) % 5 === 0 || i === 0) doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(String(d.day), 48 + i * bw, top + chartH + 3, { width: bw, align: 'center' });
    });
    doc.fillColor(MUTED).fontSize(7).text(`max ${max}`, 48, top - 2);
    doc.y = top + chartH + 16;

    h2('Délais');
    const fr = stats.firstResponse;
    para(`Première réponse : médiane ${fmtMin(fr.medianMinutes)}, moyenne ${fmtMin(fr.avgMinutes)}, ${fr.within1h ?? '—'} % en moins d'une heure, ${fr.unanswered} ticket(s) sans réponse.`);
    doc.moveDown(0.5);
    row(['Étape', 'Délai', 'Passages', 'Durée médiane', 'Hors délai', 'Respect'], [90, 60, 70, 100, 80, 100], true);
    for (const s of stats.stages) {
      row([STAGE_NAME[s.stage], s.slaHours ? `${s.slaHours} h` : 'aucun', s.measured, fmtMin(s.medianMinutes), s.slaHours ? s.breached : '—', s.compliance != null ? `${s.compliance} %` : '—'], [90, 60, 70, 100, 80, 100]);
    }

    h2('Satisfaction');
    para(`${stats.satisfaction.total} note(s)${stats.satisfaction.average != null ? `, moyenne ${stats.satisfaction.average} / 5` : ''}.`);
    doc.moveDown(0.3);
    const smax = Math.max(1, ...stats.satisfaction.distribution.map(d => d.n));
    for (const d of [...stats.satisfaction.distribution].reverse()) {
      const y = doc.y;
      doc.fillColor(INK).fontSize(9).text(`${d.rating} étoile${d.rating > 1 ? 's' : ''}`, 48, y, { width: 60 });
      doc.rect(110, y + 1, Math.max(2, (d.n / smax) * (W - 110)), 8).fillColor(ACCENT).fill();
      doc.fillColor(INK).text(String(d.n), 48 + W - 30, y, { width: 30, align: 'right' });
      doc.y = y + 14;
    }

    if (doc.y > doc.page.height - 260) doc.addPage();
    h2('Classement du staff (tickets fermés)');
    if (!stats.staff.length) para('Aucun ticket fermé par le staff ce mois-ci.', MUTED);
    else {
      row(['#', 'Membre', 'Tickets fermés', 'Note moyenne'], [30, 220, 120, 130], true);
      stats.staff.forEach((s, i) => row([i + 1, s.name, s.closed, s.rating != null ? `${s.rating} / 5` : '—'], [30, 220, 120, 130]));
    }

    h2('Sujets les plus fréquents');
    if (!stats.subjects.length) para('Aucun ticket ce mois-ci.', MUTED);
    else stats.subjects.forEach(s => row([s.subject, `${s.n} ticket(s)`], [380, 120]));

    doc.moveDown(2).font('Helvetica').fontSize(8).fillColor(MUTED).text(`Généré le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`, 48, doc.y, { width: W });
    doc.end();
  });
}

// BullMQ job 'monthly-report' (1st of the month, 9:00): previous month, posted in each guild's channel
async function sendMonthlyReports(client) {
  const { getActiveGuilds } = require('./guildScan');
  const { getTenantDb } = require('./tenantDb');
  const { fetchGuildChannel } = require('./discordGuard');
  const month = previousMonth();
  let sent = 0;
  for (const { guild_id, guild_name } of await getActiveGuilds()) {
    try {
      const db = getTenantDb(guild_id);
      const [cfg] = await db('SELECT monthly_report_channel_id FROM guild_config WHERE id = 1');
      if (!cfg?.monthly_report_channel_id) continue;
      const channel = await fetchGuildChannel(client, guild_id, cfg.monthly_report_channel_id);
      if (!channel?.isTextBased?.()) continue;
      const stats = await computeMonthlyStats(db, month);
      const pdf = await renderReportPdf(stats, guild_name || guild_id);
      await channel.send({
        content: `📊 **Rapport mensuel — ${stats.label}** : ${stats.opened} ticket(s) ouverts, ${stats.closed} fermés${stats.satisfaction.average != null ? `, satisfaction ${stats.satisfaction.average}/5` : ''}.`,
        files: [{ attachment: pdf, name: `rapport-${month}.pdf` }],
      });
      sent++;
    } catch (err) {
      logger.error('Rapport mensuel', { guildId: guild_id, err: err.message });
    }
  }
  return sent;
}

module.exports = { computeMonthlyStats, renderReportPdf, sendMonthlyReports, previousMonth };
