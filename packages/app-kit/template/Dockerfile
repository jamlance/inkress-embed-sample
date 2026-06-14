# Multi-stage build for an @inkress/app-kit app in the bookerva-apps monorepo.
# Coolify: base_directory "/", dockerfile_location "/apps/__APP_NAME__/Dockerfile".
FROM node:20-slim AS base
# git: pnpm fetches @inkress/app-bridge from github. ca-certificates: https git.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# --- deps + build (whole workspace, so @inkress/app-kit + this app resolve) ---
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile=false
# Build the kit first, then the app.
RUN pnpm --filter @inkress/app-kit build
RUN pnpm --filter __APP_NAME__ build

# --- runtime ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/__APP_NAME__
EXPOSE 3000
CMD ["node", "server.mjs"]
