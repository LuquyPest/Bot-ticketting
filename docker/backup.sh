#!/usr/bin/env bash
# Nightly backup of every ticketbot_* database (service « backup », docker-compose.backup.yml):
# one archive per night in ./backups, archives older than BACKUP_KEEP_DAYS removed.
#   docker compose run --rm backup now     → one backup right away
set -euo pipefail
TIME="${BACKUP_TIME:-03:00}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
export MYSQL_PWD="$MARIADB_ROOT_PASSWORD" # never on the command line
OWNER="$(stat -c %u:%g /backups)"         # archives belong to whoever owns ./backups on the host

dump() {
  local out="/backups/ticketbot-$(date +%Y%m%d-%H%M%S).sql.gz"
  local dbs
  dbs="$(mariadb -h db -uroot -N -e "SHOW DATABASES LIKE 'ticketbot%'" | tr '\n' ' ')"
  mariadb-dump -h db -uroot --single-transaction --routines --events --databases $dbs | gzip > "$out.part"
  mv "$out.part" "$out"
  chmod 600 "$out"; chown "$OWNER" "$out"
  find /backups -name 'ticketbot-*.sql.gz' -mtime +"$KEEP" -delete
  echo "Sauvegarde : $out ($(du -h "$out" | cut -f1))"
}

if [[ "${1:-}" == "now" ]]; then dump; exit 0; fi

echo "Sauvegarde quotidienne à $TIME ($(date +%Z)), conservation $KEEP jours"
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%F) $TIME" +%s)
  (( next <= now )) && next=$(( next + 86400 ))
  sleep $(( next - now ))
  dump || echo "Sauvegarde échouée" >&2
done
