#!/usr/bin/env bash
# Restores a scripts/backup.sh archive into the running MariaDB (existing ticketbot_* data is replaced).
#   scripts/restore.sh backups/ticketbot-20261113-030000.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:-}"; [[ -f "$FILE" ]] || { echo "Usage : scripts/restore.sh backups/ticketbot-<date>.sql.gz"; exit 1; }
read -rp "Remplacer les bases ticketbot_* par $FILE ? (oui/non) " ok; [[ "$ok" == "oui" ]] || exit 1
docker compose stop bot
gunzip -c "$FILE" | docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"'
docker compose start bot
echo "✅ Restauré. Le bot redémarre (migrations appliquées si besoin) : docker compose logs -f bot"
