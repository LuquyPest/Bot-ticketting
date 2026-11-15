#!/usr/bin/env bash
# Nightly backup of every ticketbot_* database (service « backup », docker-compose.backup.yml):
# one encrypted archive per night in ./backups, archives older than BACKUP_KEEP_DAYS removed.
#   ticketbot-<date>.sql.gz.enc   AES-256-CBC, key derived from BACKUP_KEY (PBKDF2, 200 000 rounds)
#   ticketbot-<date>.sql.gz.enc.hmac   HMAC-SHA256 of the archive (checked before any restore)
#   docker compose run --rm backup now      → one backup right away
#   docker compose run --rm backup verify   → checks the latest archive right away
# BACKUP_VERIFY=weekly|daily: after the backup (weekly: on Sundays), the latest archive is checked —
# HMAC, decryption, gzip and end of the SQL dump — without writing anything in clear.
# Results go to ./backups/status/*.json (no secret in them), read by the dashboard (Instance → Santé).
# The key is shown to the owner of the instance in the dashboard (Paramètres → Sécurité).
set -euo pipefail
TIME="${BACKUP_TIME:-03:00}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
VERIFY="${BACKUP_VERIFY:-off}"
: "${BACKUP_KEY:?BACKUP_KEY manquant : les sauvegardes ne sont jamais écrites en clair}"
export MYSQL_PWD="${MARIADB_ROOT_PASSWORD:-}" # never on the command line (not needed by verify)
OWNER="$(stat -c %u:%g /backups)"         # archives belong to whoever owns ./backups on the host
STATUS=/backups/status
mkdir -p "$STATUS"; chown "$OWNER" "$STATUS"; chmod 755 "$STATUS"

json_str() { printf '%s' "$1" | head -c 300 | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r'; }
# status NAME ok|error FILE MESSAGE — written atomically, readable by the bot
status() {
  local f="$STATUS/$1.json" ok=false bytes=0
  [[ "$2" == ok ]] && ok=true
  [[ -n "$3" && -f "$3" ]] && bytes="$(stat -c %s "$3")"
  printf '{"ok":%s,"at":"%s","file":"%s","bytes":%s,"message":"%s"}\n' \
    "$ok" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(json_str "$(basename "${3:-}")")" "$bytes" "$(json_str "${4:-}")" > "$f.part"
  chmod 644 "$f.part"; chown "$OWNER" "$f.part"; mv "$f.part" "$f"
}

dump() {
  local out="/backups/ticketbot-$(date +%Y%m%d-%H%M%S).sql.gz.enc"
  local dbs
  # Called from an `if`: errexit is off here, so every step is checked by hand
  dbs="$(mariadb -h db -uroot -N -e "SHOW DATABASES LIKE 'ticketbot%'" | tr '\n' ' ')" || return 1
  [[ -n "${dbs// /}" ]] || return 1
  if ! mariadb-dump -h db -uroot --single-transaction --routines --events --databases $dbs \
    | gzip \
    | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass env:BACKUP_KEY > "$out.part"; then
    rm -f "$out.part"; return 1
  fi
  openssl dgst -sha256 -hmac "$BACKUP_KEY" -r "$out.part" | cut -d' ' -f1 > "$out.hmac" || { rm -f "$out.part" "$out.hmac"; return 1; }
  mv "$out.part" "$out" || return 1
  chmod 600 "$out" "$out.hmac"; chown "$OWNER" "$out" "$out.hmac"
  find /backups -maxdepth 1 \( -name 'ticketbot-*.sql.gz.enc' -o -name 'ticketbot-*.sql.gz.enc.hmac' \) -mtime +"$KEEP" -delete
  status backup ok "$out" ""
  echo "Sauvegarde chiffrée : $out ($(du -h "$out" | cut -f1))"
}

# Checks the latest archive without writing it in clear anywhere
verify() {
  local last
  last="$(ls -1t /backups/ticketbot-*.sql.gz.enc 2>/dev/null | head -1 || true)"
  if [[ -z "$last" ]]; then status verify error "" "Aucune archive à vérifier"; echo "Aucune archive à vérifier" >&2; return 1; fi
  if [[ ! -f "$last.hmac" ]] || [[ "$(openssl dgst -sha256 -hmac "$BACKUP_KEY" -r "$last" | cut -d' ' -f1)" != "$(cat "$last.hmac")" ]]; then
    status verify error "$last" "Contrôle d'intégrité (HMAC) en échec : archive modifiée, abîmée ou autre clé"; echo "HMAC en échec : $last" >&2; return 1
  fi
  local tail
  if ! tail="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_KEY -in "$last" | gunzip | tail -c 400)"; then
    status verify error "$last" "Déchiffrement ou décompression impossible"; echo "Déchiffrement impossible : $last" >&2; return 1
  fi
  if ! grep -q 'Dump completed' <<< "$tail"; then
    status verify error "$last" "Archive incomplète : la fin du dump SQL est absente"; echo "Archive incomplète : $last" >&2; return 1
  fi
  status verify ok "$last" ""
  echo "Archive vérifiée : $last"
}

backup_then_verify() {
  if ! dump; then status backup error "" "La sauvegarde a échoué (voir docker compose logs backup)"; echo "Sauvegarde échouée" >&2; return 1; fi
  case "$VERIFY" in
    daily) verify || true ;;
    weekly) [[ "$(date +%u)" == 7 ]] && { verify || true; } ;;
  esac
  return 0
}

case "${1:-}" in
  now) backup_then_verify; exit $? ;;
  verify) verify; exit $? ;;
esac

echo "Sauvegarde chiffrée quotidienne à $TIME ($(date +%Z)), conservation $KEEP jours, vérification : $VERIFY"
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%F) $TIME" +%s)
  (( next <= now )) && next=$(( next + 86400 ))
  sleep $(( next - now ))
  backup_then_verify || true
done
