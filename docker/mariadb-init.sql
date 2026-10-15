-- Create the global database immediately so grants apply to an existing DB
CREATE DATABASE IF NOT EXISTS `ticketbot_global`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Grant full access on global DB and all future per-guild DBs.
-- A database-level grant on a pattern includes CREATE DATABASE / DROP DATABASE and
-- REFERENCES for matching names, so no global (*.*) privilege is needed.
GRANT ALL PRIVILEGES ON `ticketbot_global`.* TO 'botuser'@'%';
GRANT ALL PRIVILEGES ON `ticketbot\_guild\_%`.* TO 'botuser'@'%';
FLUSH PRIVILEGES;
