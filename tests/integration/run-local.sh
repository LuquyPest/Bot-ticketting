#!/usr/bin/env bash
# Runs the integration suite against throwaway MariaDB + Redis containers (removed on exit).
set -euo pipefail
cd "$(dirname "$0")/../.."

ID="tb-test-$$"
DB_PORT="${DB_PORT:-33061}"
REDIS_PORT="${REDIS_PORT:-63791}"

cleanup() { docker rm -f "$ID-db" "$ID-redis" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --rm --name "$ID-db" -p "127.0.0.1:$DB_PORT:3306" \
  -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=ticketbot_global \
  -e MARIADB_USER=botuser -e MARIADB_PASSWORD=pw \
  -v "$PWD/docker/mariadb-init.sql:/docker-entrypoint-initdb.d/init.sql:ro" mariadb:11 >/dev/null
docker run -d --rm --name "$ID-redis" -p "127.0.0.1:$REDIS_PORT:6379" redis:7-alpine >/dev/null

echo "Attente de MariaDB…"
for _ in $(seq 1 60); do
  docker exec "$ID-db" healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1 && break
  sleep 2
done

DB_PORT="$DB_PORT" REDIS_PORT="$REDIS_PORT" DB_USER=botuser DB_PASSWORD=pw \
  node tests/integration/harness.js 2>&1 | grep -v '^{"ts"'
exit "${PIPESTATUS[0]}"
