-- Create the global database immediately so grants apply to an existing DB
CREATE DATABASE IF NOT EXISTS `ticketbot_global`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Grant full access on global DB and all future per-guild DBs
GRANT ALL PRIVILEGES ON `ticketbot_global`.* TO 'botuser'@'%';
GRANT ALL PRIVILEGES ON `ticketbot_guild_%`.* TO 'botuser'@'%';
-- REFERENCES + CREATE needed globally to create FK constraints and new databases
GRANT CREATE, REFERENCES ON *.* TO 'botuser'@'%';
FLUSH PRIVILEGES;
