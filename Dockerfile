# ── Stage 1 : build du dashboard React ──────────────────────────────────────
FROM node:22-alpine AS dashboard-builder
WORKDIR /build
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

# ── Stage 2 : dépendances de production ─────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
 # Only what runs: no type definitions, source maps, docs or tests of the dependencies
 && rm -rf node_modules/@types \
 && find node_modules -type f \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' -o -iname 'readme*' -o -iname 'changelog*' -o -iname 'history.md' \) -delete \
 && find node_modules -type d \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name example -o -name examples \) -prune -exec rm -rf {} +

# ── Stage 3 : image de production ───────────────────────────────────────────
# Plain Alpine with only the Node.js binary (same Alpine as node:22-alpine): no npm, npx, corepack
# or yarn in the image — smaller download, fewer tools for an attacker. Same « node » user (uid 1000).
FROM alpine:3.24
RUN apk add --no-cache libstdc++ libgcc \
 && addgroup -g 1000 -S node && adduser -u 1000 -S -G node -h /home/node -s /bin/sh node \
 && mkdir -p /app/data/attachments && chown -R node:node /app
# /app/data/attachments: Docker volume « attachments » (files of the e-mails), owned by the bot
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
USER node

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .
COPY --chown=node:node --from=dashboard-builder /build/dist ./dashboard/dist

ENV NODE_ENV=production
EXPOSE 3000
LABEL org.opencontainers.image.source="https://github.com/LuquyPest/Bot-ticketting" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.description="Bot Discord de tickets par messages privés, avec dashboard web"

# Configuration par variables d'environnement (.env via docker-compose.yml) ou config.json monté
CMD ["node", "bootstrap.js"]
