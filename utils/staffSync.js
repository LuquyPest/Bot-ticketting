// Dashboard access from the Discord staff roles chosen in Paramètres (support_role_ids / chief_role_ids).
// Members holding one of these roles get a `support` account with the grade mapped to their role;
// accounts created this way (dashboard_users.discord_has_role = 1) lose access when the role is removed.
// Fondateurs and accounts managed by hand are never touched.
const { parseJsonField } = require('./jsonField');
const { recordEvent } = require('./audit');

const SUPPORT_PERMS = ['view_tickets', 'reply_ticket', 'claim_ticket', 'close_ticket', 'manage_participants'];
const CHIEF_PERMS   = [...SUPPORT_PERMS, 'view_transcripts', 'manage_users', 'view_audit'];

async function createGrade(db, name, color, perms, parentId = null) {
  const { insertId } = await db('INSERT INTO grades (name, color, parent_id) VALUES (?, ?, ?)', [name, color, parentId]);
  for (const p of perms) await db('INSERT IGNORE INTO grade_permissions (grade_id, permission) VALUES (?, ?)', [insertId, p]);
  return insertId;
}

// Grades mapped to the Discord roles; created with sensible permissions on first use (editable afterwards).
async function ensureStaffGrades(db) {
  const [cfg] = await db('SELECT support_grade_id, chief_grade_id FROM guild_config WHERE id = 1');
  const exists = async id => !!id && (await db('SELECT 1 FROM grades WHERE id = ?', [id])).length > 0;

  let chiefId = (await exists(cfg?.chief_grade_id)) ? cfg.chief_grade_id : null;
  let supportId = (await exists(cfg?.support_grade_id)) ? cfg.support_grade_id : null;
  if (!chiefId) {
    chiefId = await createGrade(db, 'Chef support', '#f59e0b', CHIEF_PERMS);
    await db('UPDATE guild_config SET chief_grade_id = ? WHERE id = 1', [chiefId]);
  }
  if (!supportId) {
    // Child of "Chef support": chiefs also see tickets restricted to the support grade
    supportId = await createGrade(db, 'Support', '#6366f1', SUPPORT_PERMS, chiefId);
    await db('UPDATE guild_config SET support_grade_id = ? WHERE id = 1', [supportId]);
  }
  return { supportId, chiefId };
}

// Returns the staff level a Discord member gets from their roles: 'chief', 'support' or null.
async function discordStaffLevel(client, db, guildId, userId) {
  const guild = await client?.guilds.fetch(guildId).catch(() => null);
  const member = guild && await guild.members.fetch(userId).catch(() => null);
  if (!member) return null;
  const [cfg] = await db('SELECT support_role_ids, chief_role_ids FROM guild_config WHERE id = 1');
  const has = ids => parseJsonField(ids).some(id => member.roles.cache.has(id));
  if (has(cfg?.chief_role_ids)) return 'chief';
  if (has(cfg?.support_role_ids)) return 'support';
  return null;
}

// Brings the user's dashboard account in line with their Discord roles. Returns their resulting role (or null).
async function syncDiscordStaff(client, db, guildId, user) {
  const [row] = await db('SELECT role, discord_has_role FROM dashboard_users WHERE user_id = ?', [user.id]);
  if (row?.role === 'fondateur') return row.role;
  const managedByRole = !row || row.role === 'nouveau' || row.discord_has_role === 1;
  if (!managedByRole) return row.role;

  const level = await discordStaffLevel(client, db, guildId, user.id);

  if (!level) {
    // Lost (or never had) the Discord role: revoke what the role had granted
    if (row?.discord_has_role === 1 && row.role === 'support') {
      const [cfg] = await db('SELECT support_grade_id, chief_grade_id FROM guild_config WHERE id = 1');
      await db('UPDATE dashboard_users SET role = "nouveau", discord_has_role = 0 WHERE user_id = ?', [user.id]);
      await db('DELETE FROM user_grades WHERE user_id = ? AND grade_id IN (?)',
        [user.id, [cfg?.support_grade_id, cfg?.chief_grade_id].filter(Boolean).concat(0)]);
      await recordEvent(db, { actor: null, action: 'staff_access_revoked', targetType: 'user', targetId: user.id, details: { user: user.username } });
      return 'nouveau';
    }
    return row?.role || null;
  }

  const { supportId, chiefId } = await ensureStaffGrades(db);
  const gradeId = level === 'chief' ? chiefId : supportId;
  const wasStaff = row?.role === 'support' && row.discord_has_role === 1;
  await db(
    `INSERT INTO dashboard_users (user_id, username, avatar, role, discord_has_role) VALUES (?, ?, ?, 'support', 1)
     ON DUPLICATE KEY UPDATE role = 'support', discord_has_role = 1, username = VALUES(username), avatar = VALUES(avatar)`,
    [user.id, user.username, user.avatar || null]
  );
  // Promotion/demotion between support and chief: keep only the grade matching the current role
  await db('DELETE FROM user_grades WHERE user_id = ? AND grade_id IN (?) AND grade_id <> ?', [user.id, [supportId, chiefId], gradeId]);
  await db(
    `INSERT IGNORE INTO user_grades (user_id, grade_id, assigned_by_id, assigned_by_tag) VALUES (?, ?, 'discord', 'Rôle Discord')`,
    [user.id, gradeId]
  );
  if (!wasStaff) {
    await recordEvent(db, { actor: null, action: 'staff_access_granted', targetType: 'user', targetId: user.id, details: { user: user.username, level } });
  }
  return 'support';
}

module.exports = { syncDiscordStaff, discordStaffLevel };
