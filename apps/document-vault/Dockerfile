# Multi-stage build for Document Vault.
FROM node:20-alpine AS builder
WORKDIR /work
RUN apk add --no-cache git python3 make g++
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/document-vault ./apps/document-vault
RUN pnpm install --no-frozen-lockfile
WORKDIR /work/apps/document-vault
RUN pnpm exec vite build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache git
COPY --from=builder /work/package.json /work/pnpm-workspace.yaml ./
COPY --from=builder /work/node_modules ./node_modules
COPY --from=builder /work/packages ./packages
COPY --from=builder /work/apps/document-vault/package.json ./apps/document-vault/package.json
COPY --from=builder /work/apps/document-vault/node_modules ./apps/document-vault/node_modules
COPY --from=builder /work/apps/document-vault/dist ./apps/document-vault/dist
COPY apps/document-vault/server.js ./apps/document-vault/server.js
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/document-vault
CMD ["node", "server.js"]
