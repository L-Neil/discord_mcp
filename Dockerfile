# syntax=docker/dockerfile:1

# Multi-stage build. The base image is multi-arch (node:22 publishes amd64 +
# arm64), so `docker buildx build --platform linux/amd64,linux/arm64` works for
# OCI Ampere A1 (arm64) and x86 nodes alike. See README for the buildx command.

# ---- builder ----------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app

# Install all deps (incl. dev) against the lockfile for a reproducible build.
COPY package.json package-lock.json* ./
# Prefer the lockfile (reproducible); fall back to install if it's absent.
RUN npm ci || npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies so we can copy a lean node_modules into the runner.
RUN npm prune --omit=dev

# ---- runner -----------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# node:22-slim ships a non-root "node" user; run as it.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
