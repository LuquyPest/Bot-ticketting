#!/bin/sh
# Off-site copy of the encrypted backups (service « offsite », docker-compose.offsite.yml).
# Every 15 minutes, copies the new ./backups/ticketbot-*.sql.gz.enc(.hmac) to BACKUP_REMOTE through
# rclone (S3, Backblaze B2, SFTP, Google Drive… configured in ./rclone/rclone.conf); once a day, removes
# from the remote the archives older than BACKUP_KEEP_DAYS. The archives are already encrypted:
# the remote never sees anything in clear. Result in ./backups/status/offsite.json (Instance → Santé).
#   docker compose run --rm --entrypoint rclone offsite config   → create the remote (interactive)
#   docker compose run --rm offsite now                          → one copy right away
set -u
: "${BACKUP_REMOTE:?BACKUP_REMOTE manquant (ex. b2:mon-bucket/ticketbot) — voir docs/guide/sauvegardes}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
STATUS=/backups/status
OWNER="$(stat -c %u:%g /backups)"
mkdir -p "$STATUS"
FILTER="--include ticketbot-*.sql.gz.enc --include ticketbot-*.sql.gz.enc.hmac"

esc() { printf '%s' "$1" | head -c 300 | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r'; }
status() { # status ok|error MESSAGE
  ok=false; [ "$1" = ok ] && ok=true
  last="$(ls -1t /backups/ticketbot-*.sql.gz.enc 2>/dev/null | head -1)"
  printf '{"ok":%s,"at":"%s","file":"%s","bytes":0,"remote":"%s","message":"%s"}\n' \
    "$ok" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(esc "$(basename "${last:-}")")" "$(esc "${BACKUP_REMOTE%%:*}")" "$(esc "$2")" > "$STATUS/offsite.json.part"
  chmod 644 "$STATUS/offsite.json.part"; chown "$OWNER" "$STATUS/offsite.json.part" 2>/dev/null
  mv "$STATUS/offsite.json.part" "$STATUS/offsite.json"
}

copy() {
  # shellcheck disable=SC2086
  if out="$(rclone copy /backups "$BACKUP_REMOTE" $FILTER --max-depth 1 2>&1)"; then
    status ok ""
    return 0
  fi
  echo "$out" >&2
  status error "$(printf '%s' "$out" | grep -v '^\s*$' | tail -1 | sed 's/^.*ERROR *: *//')"
  return 1
}

purge() {
  # shellcheck disable=SC2086
  rclone delete "$BACKUP_REMOTE" $FILTER --max-depth 1 --min-age "${KEEP}d" 2>&1 || true
}

if [ "${1:-}" = now ]; then copy; exit $?; fi

echo "Copie hors du serveur vers ${BACKUP_REMOTE%%:*}: toutes les 15 minutes, conservation $KEEP jours"
day=""
while true; do
  copy || true
  today="$(date +%F)"
  [ "$today" != "$day" ] && { purge; day="$today"; }
  sleep 900
done
