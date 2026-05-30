# Multi-stage build for Phone Order Taker.
FROM node:20-alpine AS builder
WORKDIR /work
RUN apk add --no-cache git python3 make g++
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/sales-digest ./apps/sales-digest
RUN pnpm install --no-frozen-lockfile
WORKDIR /work/apps/sales-digest
RUN pnpm exec vite build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache git
COPY --from=builder /work/package.json /work/pnpm-workspace.yaml ./
COPY --from=builder /work/node_modules ./node_modules
COPY --from=builder /work/packages ./packages
COPY --from=builder /work/apps/sales-digest/package.json ./apps/sales-digest/package.json
COPY --from=builder /work/apps/sales-digest/node_modules ./apps/sales-digest/node_modules
COPY --from=builder /work/apps/sales-digest/dist ./apps/sales-digest/dist
COPY apps/sales-digest/server.js ./apps/sales-digest/server.js
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/sales-digest
CMD ["node", "server.js"]
