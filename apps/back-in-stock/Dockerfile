# Multi-stage build for Phone Order Taker.
FROM node:20-alpine AS builder
WORKDIR /work
RUN apk add --no-cache git python3 make g++
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/back-in-stock ./apps/back-in-stock
RUN pnpm install --no-frozen-lockfile
WORKDIR /work/apps/back-in-stock
RUN pnpm exec vite build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache git
COPY --from=builder /work/package.json /work/pnpm-workspace.yaml ./
COPY --from=builder /work/node_modules ./node_modules
COPY --from=builder /work/packages ./packages
COPY --from=builder /work/apps/back-in-stock/package.json ./apps/back-in-stock/package.json
COPY --from=builder /work/apps/back-in-stock/node_modules ./apps/back-in-stock/node_modules
COPY --from=builder /work/apps/back-in-stock/dist ./apps/back-in-stock/dist
COPY apps/back-in-stock/server.js ./apps/back-in-stock/server.js
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/back-in-stock
CMD ["node", "server.js"]
