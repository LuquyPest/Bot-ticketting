// Contacts created on the fly from the tickets (utils/contacts.js): every ticket owner without an
// identity gets a contact of its own (seed = that owner) and the matching identity. Run by the
// migration (existing tickets) then regularly before the contacts are read. Pure SQL, no other
// module: tenantMigrations.js loads it.
const KIND_SQL = "CASE WHEN c.seed LIKE 'mail:%' THEN 'email' WHEN c.seed LIKE 'web:%' THEN 'web' ELSE 'discord' END";

const SYNC_STATEMENTS = [
  `INSERT IGNORE INTO contacts (display_name, email, seed)
   SELECT LEFT(COALESCE(MAX(ec.name), MAX(t.owner_tag), t.owner_id), 100), MAX(ec.address), t.owner_id
   FROM tickets t
   LEFT JOIN contact_identities ci ON ci.value = t.owner_id
   LEFT JOIN email_contacts ec ON ec.owner_id = t.owner_id
   WHERE ci.value IS NULL AND t.owner_id <> ''
   GROUP BY t.owner_id`,
  `INSERT IGNORE INTO contact_identities (value, contact_id, kind, label)
   SELECT c.seed, c.id, ${KIND_SQL}, COALESCE(c.email, c.display_name)
   FROM contacts c LEFT JOIN contact_identities ci ON ci.value = c.seed
   WHERE c.seed IS NOT NULL AND ci.value IS NULL`,
];

module.exports = { SYNC_STATEMENTS };
