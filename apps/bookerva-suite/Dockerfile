# Multi-stage build for the Bookerva Suite (9 booking verticals).
FROM node:20-alpine AS builder
WORKDIR /work
RUN apk add --no-cache git python3 make g++
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/bookerva-suite ./apps/bookerva-suite
RUN pnpm install --no-frozen-lockfile
WORKDIR /work/apps/bookerva-suite
RUN pnpm exec vite build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache git
COPY --from=builder /work/package.json /work/pnpm-workspace.yaml ./
COPY --from=builder /work/node_modules ./node_modules
COPY --from=builder /work/packages ./packages
COPY --from=builder /work/apps/bookerva-suite/package.json ./apps/bookerva-suite/package.json
COPY --from=builder /work/apps/bookerva-suite/node_modules ./apps/bookerva-suite/node_modules
COPY --from=builder /work/apps/bookerva-suite/dist ./apps/bookerva-suite/dist
COPY apps/bookerva-suite/server.js ./apps/bookerva-suite/server.js
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/bookerva-suite
CMD ["node", "server.js"]
