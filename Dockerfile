# ── Stage 1 : build du dashboard React ──────────────────────────────────────
FROM node:20-alpine AS dashboard-builder
WORKDIR /build
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

# ── Stage 2 : image de production ───────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Switch to non-root user before installing deps so node_modules is owned by node
RUN chown node:node /app
USER node

COPY --chown=node:node package*.json ./
RUN npm install --omit=dev

COPY --chown=node:node . .
COPY --chown=node:node --from=dashboard-builder /build/dist ./dashboard/dist

ENV NODE_ENV=production
EXPOSE 3000

# config.json est fourni via bind-mount au runtime (voir docker-compose.yml)
CMD ["node", "bootstrap.js"]
