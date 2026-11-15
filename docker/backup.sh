#!/usr/bin/env bash
# Nightly backup of every ticketbot_* database (service « backup », docker-compose.backup.yml):
# one encrypted archive per night in ./backups, archives older than BACKUP_KEEP_DAYS removed.
#   ticketbot-<date>.sql.gz.enc   AES-256-CBC, key derived from BACKUP_KEY (PBKDF2, 200 000 rounds)
#   ticketbot-<date>.sql.gz.enc.hmac   HMAC-SHA256 of the archive (checked before any restore)
#   docker compose run --rm backup now      → one backup right away
#   docker compose run --rm backup verify   → checks the latest archive right away
#   docker compose run --rm backup restore-guild <archive> <guild ID>   → restores one Discord server
# Restoring one server (also asked from the dashboard, Instance → Santé, through a request file in
# ./backups/requests written by the bot): its database is rebuilt from the archive into a temporary
# database, then its tables are swapped in one atomic RENAME; the tables it had before are kept in
# ticketbot_guild_<ID>_prev (cancel or delete from the dashboard). The other servers are untouched.
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
# Requests from the bot (restore one server): written by the bot's user only
REQUESTS=/backups/requests
BOT_UID="${BOT_UID:-1000}"
mkdir -p "$REQUESTS"; chown "$BOT_UID:$BOT_UID" "$REQUESTS"; chmod 700 "$REQUESTS"

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

# Archives available, newest first (name, size, date): read by the dashboard to offer a restore
list_archives() {
  local f first=1
  {
    printf '['
    for f in $(ls -1t /backups/ticketbot-*.sql.gz.enc 2>/dev/null | head -60); do
      [[ -f "$f.hmac" ]] || continue
      (( first )) || printf ','; first=0
      printf '{"file":"%s","bytes":%s,"at":"%s"}' "$(basename "$f")" "$(stat -c %s "$f")" "$(date -u -d "@$(stat -c %Y "$f")" +%Y-%m-%dT%H:%M:%SZ)"
    done
    printf ']\n'
  } > "$STATUS/archives.json.part"
  chmod 644 "$STATUS/archives.json.part"; chown "$OWNER" "$STATUS/archives.json.part"; mv "$STATUS/archives.json.part" "$STATUS/archives.json"
}

# restore_status ok|error GUILD ARCHIVE REQUEST MESSAGE
restore_status() {
  local ok=false; [[ "$1" == ok ]] && ok=true
  printf '{"ok":%s,"at":"%s","guild":"%s","file":"%s","request":"%s","message":"%s"}\n' \
    "$ok" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" "$(json_str "$3")" "$(json_str "$4")" "$(json_str "$5")" > "$STATUS/restore.json.part"
  chmod 644 "$STATUS/restore.json.part"; chown "$OWNER" "$STATUS/restore.json.part"; mv "$STATUS/restore.json.part" "$STATUS/restore.json"
}

sql() { mariadb -h db -uroot -N -e "$1"; }

# restore_guild ARCHIVE GUILD [REQUEST] — rebuilds one server's database from an archive
restore_guild() {
  local archive="$1" guild="$2" request="${3:-}"
  fail() { restore_status error "$guild" "$archive" "$request" "$1"; echo "Restauration échouée : $1" >&2; return 1; }
  [[ "$archive" =~ ^ticketbot-[0-9]{8}-[0-9]{6}\.sql\.gz\.enc$ ]] || { fail "Nom d'archive invalide"; return 1; }
  [[ "$guild" =~ ^[0-9]{17,20}$ ]] || { fail "Identifiant de serveur invalide"; return 1; }
  local f="/backups/$archive" target="ticketbot_guild_$guild"
  local tmp="${target}_restore" prev="${target}_prev"
  [[ -f "$f" && -f "$f.hmac" ]] || { fail "Archive introuvable"; return 1; }
  [[ "$(openssl dgst -sha256 -hmac "$BACKUP_KEY" -r "$f" | cut -d' ' -f1)" == "$(cat "$f.hmac")" ]] \
    || { fail "Contrôle d'intégrité (HMAC) en échec : archive modifiée, abîmée ou autre clé"; return 1; }
  echo "Restauration de $target depuis $archive…"
  sql "DROP DATABASE IF EXISTS \`$tmp\`; CREATE DATABASE \`$tmp\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" || { fail "Base temporaire impossible à créer"; return 1; }
  # The dump's session settings, then only the section of this server (its CREATE DATABASE / USE skipped)
  if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_KEY -in "$f" | gunzip \
    | awk -v db="$target" '
        /^-- Current Database: `/ { header = 0; sec = ($0 == "-- Current Database: `" db "`"); seen = 1; next }
        !seen { if ($0 ~ /^\/\*M?![0-9]+ SET /) print; next }
        sec { if ($0 ~ /^CREATE DATABASE / || $0 ~ /^USE `/) next; print }' \
    | mariadb -h db -uroot "$tmp"; then
    sql "DROP DATABASE IF EXISTS \`$tmp\`"; fail "Lecture de l'archive ou import impossible"; return 1
  fi
  local restored current
  restored="$(sql "SELECT table_name FROM information_schema.tables WHERE table_schema = '$tmp'")"
  if [[ -z "$restored" ]]; then sql "DROP DATABASE IF EXISTS \`$tmp\`"; fail "Ce serveur n'est pas dans cette archive"; return 1; fi
  current="$(sql "SELECT table_name FROM information_schema.tables WHERE table_schema = '$target'")"
  # One RENAME: the server's tables go to _prev and the restored ones take their place, atomically
  local renames="" t
  for t in $current; do renames+="\`$target\`.\`$t\` TO \`$prev\`.\`$t\`,"; done
  for t in $restored; do renames+="\`$tmp\`.\`$t\` TO \`$target\`.\`$t\`,"; done
  if ! sql "DROP DATABASE IF EXISTS \`$prev\`; CREATE DATABASE \`$prev\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            CREATE DATABASE IF NOT EXISTS \`$target\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            SET FOREIGN_KEY_CHECKS = 0; RENAME TABLE ${renames%,}; DROP DATABASE \`$tmp\`"; then
    sql "DROP DATABASE IF EXISTS \`$tmp\`"; fail "Échange des tables impossible : rien n'a été modifié"; return 1
  fi
  restore_status ok "$guild" "$archive" "$request" "$(wc -w <<< "$restored" | tr -d ' ') tables restaurées"
  echo "Serveur $guild restauré depuis $archive"
}

# Request file written by the bot: archive=…, guild=…, id=… (one per line, validated above)
handle_requests() {
  local req="$REQUESTS/restore.req"
  [[ -f "$req" ]] || return 0
  local archive="" guild="" id="" k v
  while IFS='=' read -r k v; do
    case "$k" in archive) archive="$v" ;; guild) guild="$v" ;; id) id="$v" ;; esac
  done < "$req"
  rm -f "$req"
  [[ "$id" =~ ^[A-Za-z0-9-]{1,64}$ ]] || id=""
  if ! restore_guild "$archive" "$guild" "$id"; then :; fi
}

dump() {
  local out="/backups/ticketbot-$(date +%Y%m%d-%H%M%S).sql.gz.enc"
  local dbs
  # Called from an `if`: errexit is off here, so every step is checked by hand
  # The copies kept by a restore (_prev) and its temporary database (_restore) are not backed up
  dbs="$(mariadb -h db -uroot -N -e "SHOW DATABASES LIKE 'ticketbot%'" | grep -Ev '_(prev|restore)$' | tr '\n' ' ')" || return 1
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
  list_archives
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
  # Called from an `if` so that every step is checked by hand (errexit would stop on the first one)
  restore-guild) if restore_guild "${2:-}" "${3:-}"; then exit 0; else exit 1; fi ;;
esac

echo "Sauvegarde chiffrée quotidienne à $TIME ($(date +%Z)), conservation $KEEP jours, vérification : $VERIFY"
list_archives
next=$(date -d "$(date +%F) $TIME" +%s)
(( next <= $(date +%s) )) && next=$(( next + 86400 ))
while true; do
  # Restore requests from the dashboard are picked up within a few seconds
  handle_requests
  if (( $(date +%s) >= next )); then
    backup_then_verify || true
    next=$(( next + 86400 ))
  fi
  sleep 5
done
