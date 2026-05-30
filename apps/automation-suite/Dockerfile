# Multi-stage build for the Automation Suite (digest/birthdays/tagger/restock/wa-updates).
FROM node:20-alpine AS builder
WORKDIR /work
RUN apk add --no-cache git python3 make g++
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/automation-suite ./apps/automation-suite
RUN pnpm install --no-frozen-lockfile
WORKDIR /work/apps/automation-suite
RUN pnpm exec vite build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache git
COPY --from=builder /work/package.json /work/pnpm-workspace.yaml ./
COPY --from=builder /work/node_modules ./node_modules
COPY --from=builder /work/packages ./packages
COPY --from=builder /work/apps/automation-suite/package.json ./apps/automation-suite/package.json
COPY --from=builder /work/apps/automation-suite/node_modules ./apps/automation-suite/node_modules
COPY --from=builder /work/apps/automation-suite/dist ./apps/automation-suite/dist
COPY apps/automation-suite/server.js ./apps/automation-suite/server.js
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/automation-suite
CMD ["node", "server.js"]
