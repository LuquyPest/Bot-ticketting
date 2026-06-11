-- Grant privileges to allow botuser to create per-guild databases at runtime
GRANT ALL PRIVILEGES ON `ticketbot_global`.* TO 'botuser'@'%';
GRANT ALL PRIVILEGES ON `ticketbot_guild_%`.* TO 'botuser'@'%';
GRANT CREATE ON *.* TO 'botuser'@'%';
FLUSH PRIVILEGES;
