#!/bin/sh
# One-click update (service « updater », docker-compose.updater.yml). Every 30 s, asks the bot
# (GET /api/updater/poll, UPDATER_TOKEN) whether the owner clicked « Mettre à jour » in Instance → Santé.
# If so: pulls the bot image and recreates the bot container only, waits until it is healthy, then
# reports the result (POST /api/updater/result). It never runs anything the bot sends: the answer
# is only « update or not ».
set -u
: "${UPDATER_TOKEN:?UPDATER_TOKEN manquant dans .env (openssl rand -hex 32)}"
BOT="${UPDATER_BOT_URL:-http://bot:3000}"
TAG="${TICKETBOT_VERSION:-latest}"
H_AUTH="Authorization: Bearer $UPDATER_TOKEN"
H_XRW="X-Requested-With: XMLHttpRequest"

report() { # report true|false LOG — retried while the new bot starts
  body="$(printf '{"ok":%s,"log":"%s"}' "$1" "$(printf '%s' "$2" | tail -c 2500 | sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{printf "%s\\n", $0}')")"
  i=0
  while [ $i -lt 40 ]; do
    wget -qO- --header "$H_AUTH" --header "$H_XRW" --header "Content-Type: application/json" --post-data "$body" "$BOT/api/updater/result" >/dev/null 2>&1 && return 0
    i=$((i + 1)); sleep 5
  done
  echo "Résultat non transmis au bot" >&2
}

update() {
  echo "Mise à jour demandée : docker compose pull bot"
  if ! log="$(docker compose pull bot 2>&1 && docker compose up -d --no-deps --no-build bot 2>&1)"; then
    echo "$log" >&2; report false "$log"; return
  fi
  cid="$(docker compose ps -q bot)"
  i=0
  while [ $i -lt 60 ]; do
    h="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null)"
    [ "$h" = healthy ] || [ "$h" = none ] && break
    i=$((i + 1)); sleep 5
  done
  if [ "$h" = healthy ] || [ "$h" = none ]; then
    echo "Bot redémarré ($h)"; report true "$log"
  else
    echo "Le bot ne répond pas après la mise à jour ($h)" >&2; report false "$log
Le bot n'est pas en bonne santé après la mise à jour ($h) : docker compose logs bot"
  fi
}

echo "Service de mise à jour prêt (image ${TAG}), interroge $BOT toutes les 30 s"
while true; do
  resp="$(wget -qO- --header "$H_AUTH" "$BOT/api/updater/poll?tag=$TAG" 2>/dev/null || true)"
  case "$resp" in *'"update":true'*) update ;; esac
  sleep 30
done
