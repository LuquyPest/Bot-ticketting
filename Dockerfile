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

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
COPY --from=dashboard-builder /build/dist ./dashboard/dist

# config.json est fourni via bind-mount au runtime (voir docker-compose.yml)
CMD ["node", "bootstrap.js"]
