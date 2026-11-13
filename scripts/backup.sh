#!/usr/bin/env bash
# One-off encrypted backup of every database, same format as the nightly « backup » service
# (docker/backup.sh): backups/ticketbot-<date>.sql.gz.enc + .hmac, key BACKUP_KEY from .env.
#   scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo ".env introuvable."; exit 1; }
grep -qE '^BACKUP_KEY=.+' .env || { echo "BACKUP_KEY manquant dans .env (openssl rand -hex 32)."; exit 1; }
mkdir -p backups; chmod 700 backups
docker compose -f docker-compose.yml -f docker-compose.backup.yml run --rm backup now
echo "Garde aussi une copie du .env : ENCRYPTION_KEY déchiffre les transcripts, BACKUP_KEY les sauvegardes."
