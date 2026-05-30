# Multi-stage build for the Inkress embedded-app sample.
#
# Stage 1 (builder) — install dev deps, build the Vite bundle.
# Stage 2 (runtime) — install only production deps + copy dist + run
#                     the Express server with the embedded-apps CSP
#                     headers in place.
#
# Coolify runs the final image; we listen on :3000 (matches the
# Coolify port exposure).

# ----------------------------------------------------------------- builder
FROM node:20-alpine AS builder

WORKDIR /app

# Git is needed for the github:jamlance/app-bridge dep that runs its
# `prepare` build during install. Without it npm aborts with
# `git: not found`.
RUN apk add --no-cache git python3 make g++

COPY package.json ./

# `npm install` rather than `npm ci` so platform-specific transitive
# deps (esbuild/rollup native binaries) resolve for the build host's
# arch. The lockfile is generated on darwin-arm64; reusing it inside a
# linux/amd64 builder lacks the right optionalDependencies and `npm ci`
# bails. Build-time determinism is less important here than
# host-portability — the lockfile is intentionally NOT copied.
RUN npm install

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

RUN npm run build

# ----------------------------------------------------------------- runtime
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Express is the only runtime dep; the bridge SDK + Vite are dev/build
# only. Re-install with `--omit=dev` to keep the image small.
RUN apk add --no-cache git
COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY server.js ./server.js

EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0

CMD ["node", "server.js"]
