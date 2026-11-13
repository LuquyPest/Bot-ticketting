#!/usr/bin/env bash
# Restores an encrypted backup into the running MariaDB (existing ticketbot_* data is replaced).
# The archive's HMAC is checked first; decryption happens inside the db container with BACKUP_KEY.
#   scripts/restore.sh backups/ticketbot-20261113-030000.sql.gz.enc
#   (old plain archives .sql.gz from before v3.0.4 are still accepted)
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:-}"; [[ -f "$FILE" ]] || { echo "Usage : scripts/restore.sh backups/ticketbot-<date>.sql.gz.enc"; exit 1; }
KEY="$(grep -E '^BACKUP_KEY=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"

if [[ "$FILE" == *.enc ]]; then
  [[ -n "$KEY" ]] || { echo "BACKUP_KEY absent du .env (la clé est aussi dans le dashboard : Paramètres → Sécurité)."; exit 1; }
  [[ -f "$FILE.hmac" ]] || { echo "Fichier d'intégrité $FILE.hmac introuvable."; exit 1; }
  got="$(BACKUP_KEY="$KEY" docker compose exec -T -e BACKUP_KEY db sh -c 'openssl dgst -sha256 -hmac "$BACKUP_KEY" -r | cut -d" " -f1' < "$FILE")"
  [[ "$got" == "$(cat "$FILE.hmac")" ]] || { echo "❌ Intégrité invalide : archive modifiée ou mauvaise clé. Rien n'a été restauré."; exit 1; }
  echo "Intégrité vérifiée."
fi

read -rp "Remplacer les bases ticketbot_* par $FILE ? (oui/non) " ok; [[ "$ok" == "oui" ]] || exit 1
docker compose stop bot
if [[ "$FILE" == *.enc ]]; then
  BACKUP_KEY="$KEY" docker compose exec -T -e BACKUP_KEY db sh -c 'openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_KEY | gunzip | mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"' < "$FILE"
else
  gunzip -c "$FILE" | docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"'
fi
docker compose start bot
echo "✅ Restauré. Le bot redémarre (migrations appliquées si besoin) : docker compose logs -f bot"
