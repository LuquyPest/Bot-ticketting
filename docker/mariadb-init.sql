-- Accorde le droit CREATE global à botuser
-- Nécessaire pour que bootstrap.js puisse exécuter CREATE DATABASE IF NOT EXISTS
GRANT CREATE ON *.* TO 'botuser'@'%';
FLUSH PRIVILEGES;
