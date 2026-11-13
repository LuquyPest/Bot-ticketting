#!/usr/bin/env bash
# Nightly backup of every ticketbot_* database (service « backup », docker-compose.backup.yml):
# one encrypted archive per night in ./backups, archives older than BACKUP_KEEP_DAYS removed.
#   ticketbot-<date>.sql.gz.enc   AES-256-CBC, key derived from BACKUP_KEY (PBKDF2, 200 000 rounds)
#   ticketbot-<date>.sql.gz.enc.hmac   HMAC-SHA256 of the archive (checked before any restore)
#   docker compose run --rm backup now     → one backup right away
# The key is shown to the owner of the instance in the dashboard (Paramètres → Sécurité).
set -euo pipefail
TIME="${BACKUP_TIME:-03:00}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
: "${BACKUP_KEY:?BACKUP_KEY manquant : les sauvegardes ne sont jamais écrites en clair}"
export MYSQL_PWD="$MARIADB_ROOT_PASSWORD" # never on the command line
OWNER="$(stat -c %u:%g /backups)"         # archives belong to whoever owns ./backups on the host

dump() {
  local out="/backups/ticketbot-$(date +%Y%m%d-%H%M%S).sql.gz.enc"
  local dbs
  dbs="$(mariadb -h db -uroot -N -e "SHOW DATABASES LIKE 'ticketbot%'" | tr '\n' ' ')"
  mariadb-dump -h db -uroot --single-transaction --routines --events --databases $dbs \
    | gzip \
    | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass env:BACKUP_KEY > "$out.part"
  openssl dgst -sha256 -hmac "$BACKUP_KEY" -r "$out.part" | cut -d' ' -f1 > "$out.hmac"
  mv "$out.part" "$out"
  chmod 600 "$out" "$out.hmac"; chown "$OWNER" "$out" "$out.hmac"
  find /backups \( -name 'ticketbot-*.sql.gz.enc' -o -name 'ticketbot-*.sql.gz.enc.hmac' \) -mtime +"$KEEP" -delete
  echo "Sauvegarde chiffrée : $out ($(du -h "$out" | cut -f1))"
}

if [[ "${1:-}" == "now" ]]; then dump; exit 0; fi

echo "Sauvegarde chiffrée quotidienne à $TIME ($(date +%Z)), conservation $KEEP jours"
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%F) $TIME" +%s)
  (( next <= now )) && next=$(( next + 86400 ))
  sleep $(( next - now ))
  dump || echo "Sauvegarde échouée" >&2
done
