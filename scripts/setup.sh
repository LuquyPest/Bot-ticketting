#!/usr/bin/env bash
# First install: asks the few things only you know, generates every secret and writes .env.
#   scripts/setup.sh              (asks for the language: français / English)
#   scripts/setup.sh --lang en    (or --lang fr)
# Re-run safely: an existing .env is backed up first.
set -euo pipefail
cd "$(dirname "$0")/.."

LANG_UI=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --lang) LANG_UI="${2:-}"; shift 2 ;;
    --lang=*) LANG_UI="${1#--lang=}"; shift ;;
    *) shift ;;
  esac
done
if [[ "$LANG_UI" != fr && "$LANG_UI" != en ]]; then
  def=en; [[ "${LANG:-}" == fr* ]] && def=fr
  printf 'Langue / Language — 1) Français  2) English [%s] : ' "$([[ $def == fr ]] && echo 1 || echo 2)"
  read -r choice || choice=""
  case "${choice:-}" in 1|fr|FR) LANG_UI=fr ;; 2|en|EN) LANG_UI=en ;; *) LANG_UI=$def ;; esac
fi
t() { if [[ "$LANG_UI" == en ]]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
is_yes() { [[ "$1" =~ ^[oOyY] ]]; }

command -v docker >/dev/null || { t "Docker est requis : https://docs.docker.com/engine/install/" "Docker is required: https://docs.docker.com/engine/install/"; echo; exit 1; }
docker compose version >/dev/null 2>&1 || { t "Docker Compose v2 est requis (docker compose)." "Docker Compose v2 is required (docker compose)."; echo; exit 1; }
command -v openssl >/dev/null || { t "openssl est requis." "openssl is required."; echo; exit 1; }

ask() { # ask VAR "question" [default] [secret]
  local var="$1" q="$2" def="${3:-}" secret="${4:-}" val
  while true; do
    if [[ -n "$def" ]]; then printf '%s [%s] : ' "$q" "$def"; else printf '%s : ' "$q"; fi
    if [[ -n "$secret" ]]; then read -rs val; echo; else read -r val; fi
    val="${val:-$def}"
    [[ -n "$val" ]] && break
    echo "  $(t "Valeur obligatoire." "Required.")"
  done
  printf -v "$var" '%s' "$val"
}
gen() { openssl rand -hex 32; }
YN="$(t o y)"; NY="n"

echo "── Ticket Bot : $(t configuration setup) ──────────────────────────────────────────"
t "Crée d'abord l'application sur https://discord.com/developers/applications
(onglet Bot → Reset Token, décoche « Public Bot », active les intents « Server Members » et « Message Content » ;
 onglet OAuth2 → Client Secret). Le compte Discord propriétaire de cette application administrera l'instance." \
  "First create the application on https://discord.com/developers/applications
(Bot tab → Reset Token, untick « Public Bot », enable the « Server Members » and « Message Content » intents;
 OAuth2 tab → Client Secret). The Discord account that owns this application will administer the instance."
echo; echo
ask DISCORD_TOKEN         "$(t "Token du bot Discord" "Discord bot token")" "" secret
ask DISCORD_CLIENT_ID     "$(t "ID de l'application (Application ID)" "Application ID")"
ask DISCORD_CLIENT_SECRET "$(t "Client Secret OAuth2" "OAuth2 Client Secret")" "" secret
ask PUBLIC_HOST           "$(t "Domaine public du dashboard (ex. tickets.example.com)" "Public domain of the dashboard (e.g. tickets.example.com)")"
ask ACME_EMAIL            "$(t "Ton e-mail (certificats HTTPS et notifications push)" "Your e-mail (HTTPS certificates and push notifications)")"
echo
t "HTTPS :  1) Caddy inclus — recommandé, ports 80 et 443 libres
         2) Traefik déjà en place (réseau Docker « proxy »)
         3) Aucun — port local 3000 seulement, je gère mon proxy" \
  "HTTPS:   1) Bundled Caddy — recommended, ports 80 and 443 free
         2) Traefik already running (Docker network « proxy »)
         3) None — local port 3000 only, I run my own proxy"
echo
ask PROXY "$(t Choix Choice)" "1"
case "$PROXY" in
  2) COMPOSE_FILE="docker-compose.yml:docker-compose.traefik.yml" ;;
  3) COMPOSE_FILE="docker-compose.yml" ;;
  *) COMPOSE_FILE="docker-compose.yml:docker-compose.caddy.yml" ;;
esac

BACKUP_VERIFY=off; BACKUP_REMOTE=""
ask BACKUP "$(t "Sauvegarder les bases chaque nuit dans ./backups ? (o/n)" "Back up the databases every night into ./backups? (y/n)")" "$YN"
if is_yes "$BACKUP"; then
  COMPOSE_FILE="$COMPOSE_FILE:docker-compose.backup.yml"
  ask VERIFY "$(t "Vérifier la dernière archive chaque semaine (déchiffrement et test) ? (o/n)" "Check the latest archive every week (decryption and test)? (y/n)")" "$YN"
  is_yes "$VERIFY" && BACKUP_VERIFY=weekly
  ask OFFSITE "$(t "Copier aussi les sauvegardes hors du serveur (S3, Backblaze, SFTP…) avec rclone ? (o/n)" "Also copy the backups off the server (S3, Backblaze, SFTP…) with rclone? (y/n)")" "$NY"
  if is_yes "$OFFSITE"; then
    mkdir -p rclone && chmod 700 rclone
    t "L'assistant de rclone va créer la destination (n = nouvelle, puis suis les questions de ton fournisseur)." \
      "The rclone wizard will now create the destination (n = new remote, then follow your provider's questions)."
    echo
    docker run --rm -it -v "$PWD/rclone:/config/rclone" rclone/rclone:1.71 config || true
    ask BACKUP_REMOTE "$(t "Destination : nom choisi, deux-points, bucket ou dossier (ex. b2:mon-bucket/ticketbot)" "Destination: chosen name, colon, bucket or folder (e.g. b2:my-bucket/ticketbot)")"
    COMPOSE_FILE="$COMPOSE_FILE:docker-compose.offsite.yml"
  fi
fi

t "Bouton « Mettre à jour » dans le dashboard : un petit service a alors accès à Docker pour redémarrer le bot
(équivalent d'un accès administrateur à la machine, isolé du bot)." \
  "« Update » button in the dashboard: a small service then gets access to Docker to restart the bot
(equivalent to administrator access to the machine, kept apart from the bot)."
echo
ask UPDATER "$(t "L'activer ? (o/n, recommandé)" "Enable it? (y/n, recommended)")" "$YN"
is_yes "$UPDATER" && COMPOSE_FILE="$COMPOSE_FILE:docker-compose.updater.yml"
TZ_HOST="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo UTC)"
echo

# VAPID keys for push notifications: from the published image, or a local Node, otherwise skipped
VAPID_PUBLIC_KEY=""; VAPID_PRIVATE_KEY=""
gen_vapid() { node -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)" 2>/dev/null; }
VAPID="$( (docker run --rm --entrypoint node ghcr.io/luquypest/bot-ticketting:latest -e "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)" 2>/dev/null) || (command -v node >/dev/null && [[ -d node_modules/web-push ]] && gen_vapid) || true)"
if [[ -n "$VAPID" ]]; then VAPID_PUBLIC_KEY="${VAPID% *}"; VAPID_PRIVATE_KEY="${VAPID#* }"
else t "⚠️  Clés VAPID non générées (pas d'image ni de Node) : notifications push désactivées, voir https://docs.bot.daryu.xyz/guide/configuration" \
       "⚠️  VAPID keys not generated (no image nor Node): push notifications disabled, see https://docs.bot.daryu.xyz/guide/configuration"; echo; fi

[[ -f .env ]] && { cp .env ".env.bak.$(date +%Y%m%d%H%M%S)"; t "Ancien .env sauvegardé." "Previous .env backed up."; echo; }
mkdir -p backups && chmod 700 backups
umask 077
cat > .env <<ENV
# $(t "Généré par scripts/setup.sh le" "Generated by scripts/setup.sh on") $(date -I). $(t "Garde ce fichier privé (chmod 600) : il contient tous les secrets." "Keep this file private (chmod 600): it holds every secret.")
DISCORD_TOKEN=$DISCORD_TOKEN
DISCORD_CLIENT_ID=$DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET=$DISCORD_CLIENT_SECRET

PUBLIC_HOST=$PUBLIC_HOST
PUBLIC_URL=https://$PUBLIC_HOST
ACME_EMAIL=$ACME_EMAIL
VAPID_CONTACT=$ACME_EMAIL
COMPOSE_FILE=$COMPOSE_FILE
TZ=$TZ_HOST
PROJECT_DIR=$PWD

DB_ROOT_PASSWORD=$(gen)
DB_PASSWORD=$(gen)
REDIS_PASSWORD=$(gen)
SESSION_SECRET=$(gen)
ENCRYPTION_KEY=$(gen)
BACKUP_KEY=$(gen)
UPDATER_TOKEN=$(gen)
VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY

CONTACT_EMAIL=$ACME_EMAIL
TICKETBOT_VERSION=latest
BACKUP_TIME=03:00
BACKUP_KEEP_DAYS=30
BACKUP_VERIFY=$BACKUP_VERIFY
BACKUP_REMOTE=$BACKUP_REMOTE
ENV
chmod 600 .env

PORTS=""; [[ "$PROXY" == 1 || "$PROXY" == "" ]] && PORTS="$(t " (ports 80 et 443 ouverts)" " (ports 80 and 443 open)")"
if [[ "$LANG_UI" == en ]]; then cat <<MSG

✅ .env written.

Last steps:
  1. Discord portal → OAuth2 → Redirects: add exactly
       https://$PUBLIC_HOST/api/auth/discord/callback
  2. Point the DNS of $PUBLIC_HOST to this server$PORTS
  3. Start:    docker compose pull && docker compose up -d
     Follow:   docker compose logs -f bot
  4. Open https://$PUBLIC_HOST and sign in with the Discord account that owns the application:
     you are the owner of the instance. Invite the bot to your server from « Mes serveurs » (My servers);
     the server is ready as soon as the bot joins, and the « Instance » section gives you control of everything.
     The dashboard follows your browser language (English or French); the language button at the bottom of the menu switches it.
MSG
else cat <<MSG

✅ .env écrit.

Dernières étapes :
  1. Portail Discord → OAuth2 → Redirects : ajoute exactement
       https://$PUBLIC_HOST/api/auth/discord/callback
  2. Fais pointer le DNS de $PUBLIC_HOST vers ce serveur$PORTS
  3. Démarre :   docker compose pull && docker compose up -d
     Suis :      docker compose logs -f bot
  4. Ouvre https://$PUBLIC_HOST et connecte-toi avec le compte Discord propriétaire de l'application :
     tu es le propriétaire de l'instance. Invite le bot sur ton serveur depuis « Mes serveurs » ;
     le serveur est prêt dès que le bot arrive, et la section « Instance » te donne la main sur tout.
MSG
fi
