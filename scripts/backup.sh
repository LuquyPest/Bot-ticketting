#!/usr/bin/env bash
# Backs up every database (global + one per Discord server) to backups/ticketbot-<date>.sql.gz,
# then prunes the archives older than KEEP_DAYS (30). Redis only holds sessions and queues: not saved.
#   scripts/backup.sh            cron: 0 3 * * * /chemin/Bot-ticketting/scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo ".env introuvable."; exit 1; }
KEEP_DAYS="${KEEP_DAYS:-30}"
mkdir -p backups; chmod 700 backups
OUT="backups/ticketbot-$(date +%Y%m%d-%H%M%S).sql.gz"
# The dump runs inside the db container, the root password is read from its environment
docker compose exec -T db sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --events --databases $(mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -e "SHOW DATABASES LIKE '"'"'ticketbot%'"'"'" | tr "\n" " ")' | gzip > "$OUT"
chmod 600 "$OUT"
find backups -name 'ticketbot-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "✅ $OUT ($(du -h "$OUT" | cut -f1)). Sauvegarde aussi .env : il contient la clé qui déchiffre les transcripts."
