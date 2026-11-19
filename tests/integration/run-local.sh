#!/usr/bin/env bash
# Runs the integration suite against throwaway MariaDB + Redis containers (removed on exit).
set -euo pipefail
cd "$(dirname "$0")/../.."

ID="tb-test-$$"
DB_PORT="${DB_PORT:-33061}"
REDIS_PORT="${REDIS_PORT:-63791}"
LDAP_PORT="${LDAP_PORT:-33891}"
LDAPS_PORT="${LDAPS_PORT:-36361}"
CERTS="$(mktemp -d)"

cleanup() { docker rm -f "$ID-db" "$ID-redis" "$ID-ldap" >/dev/null 2>&1 || true; rm -rf "$CERTS"; }
trap cleanup EXIT

docker run -d --rm --name "$ID-db" -p "127.0.0.1:$DB_PORT:3306" \
  -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=ticketbot_global \
  -e MARIADB_USER=botuser -e MARIADB_PASSWORD=pw \
  -v "$PWD/docker/mariadb-init.sql:/docker-entrypoint-initdb.d/init.sql:ro" mariadb:11 >/dev/null
docker run -d --rm --name "$ID-redis" -p "127.0.0.1:$REDIS_PORT:6379" redis:7-alpine >/dev/null

bash tests/integration/ldap-server.sh "$ID-ldap" "$LDAP_PORT" "$LDAPS_PORT" "$CERTS" &
LDAP_PID=$!

echo "Attente de MariaDB…"
for _ in $(seq 1 60); do
  docker exec "$ID-db" healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1 && break
  sleep 2
done

wait "$LDAP_PID"
DB_PORT="$DB_PORT" REDIS_PORT="$REDIS_PORT" DB_USER=botuser DB_PASSWORD=pw \
  LDAP_TEST_URL="ldaps://localhost:$LDAPS_PORT" LDAP_TEST_STARTTLS_URL="ldap://localhost:$LDAP_PORT" LDAP_TEST_CA="$CERTS/ca.crt" \
  node tests/integration/harness.js 2>&1 | grep -v '^{"ts"'
exit "${PIPESTATUS[0]}"
