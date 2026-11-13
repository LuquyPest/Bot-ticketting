# ── Stage 1 : build du dashboard React ──────────────────────────────────────
FROM node:22-alpine AS dashboard-builder
WORKDIR /build
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

# ── Stage 2 : image de production ───────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Switch to non-root user before installing deps so node_modules is owned by node
RUN chown node:node /app
USER node

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .
COPY --chown=node:node --from=dashboard-builder /build/dist ./dashboard/dist

ENV NODE_ENV=production
EXPOSE 3000
LABEL org.opencontainers.image.source="https://github.com/LuquyPest/Bot-ticketting" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.description="Bot Discord de tickets par messages privés, avec dashboard web"

# Configuration par variables d'environnement (.env via docker-compose.yml) ou config.json monté
CMD ["node", "bootstrap.js"]
