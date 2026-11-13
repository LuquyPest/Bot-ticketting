#!/usr/bin/env bash
# First install: asks the few things only you know, generates every secret and writes .env.
#   scripts/setup.sh          (re-run safely: an existing .env is backed up first)
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Docker est requis : https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 est requis (docker compose)."; exit 1; }
command -v openssl >/dev/null || { echo "openssl est requis."; exit 1; }

ask() { # ask VAR "question" [default] [secret]
  local var="$1" q="$2" def="${3:-}" secret="${4:-}" val
  while true; do
    if [[ -n "$def" ]]; then printf '%s [%s] : ' "$q" "$def"; else printf '%s : ' "$q"; fi
    if [[ -n "$secret" ]]; then read -rs val; echo; else read -r val; fi
    val="${val:-$def}"
    [[ -n "$val" ]] && break
    echo "  Valeur obligatoire."
  done
  printf -v "$var" '%s' "$val"
}
gen() { openssl rand -hex 32; }

echo "── Ticket Bot : configuration ──────────────────────────────────────────"
echo "Crée d'abord l'application sur https://discord.com/developers/applications"
echo "(onglet Bot → Reset Token, décoche « Public Bot », active les intents « Server Members » et « Message Content » ;"
echo " onglet OAuth2 → Client Secret). Le compte Discord propriétaire de cette application administrera l'instance."
echo
ask DISCORD_TOKEN         "Token du bot Discord" "" secret
ask DISCORD_CLIENT_ID     "ID de l'application (Application ID)"
ask DISCORD_CLIENT_SECRET "Client Secret OAuth2" "" secret
ask PUBLIC_HOST           "Domaine public du dashboard (ex. tickets.example.com)"
ask ACME_EMAIL            "Ton e-mail (certificats HTTPS et notifications push)"
echo
echo "HTTPS :  1) Caddy inclus — recommandé, ports 80 et 443 libres"
echo "         2) Traefik déjà en place (réseau Docker « proxy »)"
echo "         3) Aucun — port local 3000 seulement, je gère mon proxy"
ask PROXY "Choix" "1"
case "$PROXY" in
  2) COMPOSE_FILE="docker-compose.yml:docker-compose.traefik.yml" ;;
  3) COMPOSE_FILE="docker-compose.yml" ;;
  *) COMPOSE_FILE="docker-compose.yml:docker-compose.caddy.yml" ;;
esac
ask BACKUP "Sauvegarder les bases chaque nuit dans ./backups ? (o/n)" "o"
[[ "$BACKUP" =~ ^[oOyY] ]] && COMPOSE_FILE="$COMPOSE_FILE:docker-compose.backup.yml"
TZ_HOST="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo UTC)"
echo

# VAPID keys for push notifications: from the published image, or a local Node, otherwise skipped
VAPID_PUBLIC_KEY=""; VAPID_PRIVATE_KEY=""
gen_vapid() { node -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)" 2>/dev/null; }
VAPID="$( (docker run --rm --entrypoint node ghcr.io/luquypest/bot-ticketting:latest -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)" 2>/dev/null) || (command -v node >/dev/null && [[ -d node_modules/web-push ]] && gen_vapid) || true)"
if [[ -n "$VAPID" ]]; then VAPID_PUBLIC_KEY="${VAPID% *}"; VAPID_PRIVATE_KEY="${VAPID#* }"; else echo "⚠️  Clés VAPID non générées (pas d'image ni de Node) : notifications push désactivées, voir INSTALL.md."; fi

[[ -f .env ]] && { cp .env ".env.bak.$(date +%Y%m%d%H%M%S)"; echo "Ancien .env sauvegardé."; }
mkdir -p backups && chmod 700 backups
umask 077
cat > .env <<ENV
# Généré par scripts/setup.sh le $(date -I). Garde ce fichier privé (chmod 600) : il contient tous les secrets.
DISCORD_TOKEN=$DISCORD_TOKEN
DISCORD_CLIENT_ID=$DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET=$DISCORD_CLIENT_SECRET

PUBLIC_HOST=$PUBLIC_HOST
PUBLIC_URL=https://$PUBLIC_HOST
ACME_EMAIL=$ACME_EMAIL
VAPID_CONTACT=$ACME_EMAIL
COMPOSE_FILE=$COMPOSE_FILE
TZ=$TZ_HOST

DB_ROOT_PASSWORD=$(gen)
DB_PASSWORD=$(gen)
REDIS_PASSWORD=$(gen)
SESSION_SECRET=$(gen)
ENCRYPTION_KEY=$(gen)
BACKUP_KEY=$(gen)
VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY

CONTACT_EMAIL=$ACME_EMAIL
TICKETBOT_VERSION=latest
BACKUP_TIME=03:00
BACKUP_KEEP_DAYS=30
ENV
chmod 600 .env

cat <<MSG

✅ .env écrit.

Dernières étapes :
  1. Portail Discord → OAuth2 → Redirects : ajoute exactement
       https://$PUBLIC_HOST/api/auth/discord/callback
  2. Fais pointer le DNS de $PUBLIC_HOST vers ce serveur$( [[ "$PROXY" == 1 || "$PROXY" == "" ]] && echo " (ports 80 et 443 ouverts)")
  3. Démarre :   docker compose pull && docker compose up -d
     Suis :      docker compose logs -f bot
  4. Ouvre https://$PUBLIC_HOST et connecte-toi avec le compte Discord propriétaire de l'application :
     tu es le propriétaire de l'instance. Invite le bot sur ton serveur depuis « Mes serveurs » ;
     le serveur est prêt dès que le bot arrive, et la section « Instance » te donne la main sur tout.
MSG
