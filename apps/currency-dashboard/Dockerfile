# Multi-stage build for the Currency Dashboard embedded app.
#
# Build context is the monorepo root (Coolify base_directory = /).
# This Dockerfile copies the workspace skeleton + this one app +
# the @bookerva-apps/core package + the @inkress/app-bridge git dep,
# installs everything, builds, then carries only the dist + server
# into the runtime image.

# --------------------------------------------------------------- builder
FROM node:20-alpine AS builder
WORKDIR /work
RUN apk add --no-cache git python3 make g++
RUN npm install -g pnpm@9

# Workspace skeleton
COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/currency-dashboard ./apps/currency-dashboard

# Install all workspaces (uses git for @inkress/app-bridge prepare)
RUN pnpm install --no-frozen-lockfile

# Build the SPA
WORKDIR /work/apps/currency-dashboard
RUN pnpm exec vite build

# --------------------------------------------------------------- runtime
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache git
RUN npm install -g pnpm@9

# Re-install in a slim runtime-only layout. Reuse package.json so
# pnpm resolves only production deps.
COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/currency-dashboard/package.json ./apps/currency-dashboard/package.json
RUN pnpm install --prod --no-frozen-lockfile

COPY apps/currency-dashboard/server.js ./apps/currency-dashboard/server.js
COPY --from=builder /work/apps/currency-dashboard/dist ./apps/currency-dashboard/dist

EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/currency-dashboard
CMD ["node", "server.js"]
