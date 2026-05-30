#!/usr/bin/env node
/**
 * Scaffold a new app under apps/<name>/ with the shared boilerplate.
 *
 *   node scripts/scaffold-app.mjs <name> <title> [brand]
 *
 *   <name>  kebab-case (becomes the dir + package suffix)
 *   <title> human title for <h1>
 *   [brand] "marketplace" (default) | "bookerva"
 *
 * Produces: package.json, tsconfig.json, vite.config.ts, Dockerfile,
 *           index.html, src/index.css, src/bv-init.ts, src/main.ts,
 *           server.js — all wired to @bookerva-apps/core.
 *
 * Apps that need SQLite get `better-sqlite3` added by their main.ts
 * import — the package.json template already includes it.
 *
 * Idempotent: refuses to clobber an existing apps/<name>.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const [, , name, title, brandArg] = process.argv;
if (!name || !title) {
  console.error("Usage: scaffold-app.mjs <name> <title> [brand]");
  process.exit(2);
}
const brand = brandArg === "bookerva" ? "bookerva" : "marketplace";
const dir = path.join(ROOT, "apps", name);
if (fs.existsSync(dir)) {
  console.error(`Already exists: ${dir}`);
  process.exit(3);
}
fs.mkdirSync(path.join(dir, "src"), { recursive: true });

const files = {
  "package.json": JSON.stringify(
    {
      name: `@bookerva-apps/${name}`,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        build: "vite build",
        start: "node server.js",
        dev: "vite",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        "@bookerva-apps/core": "workspace:*",
        "@inkress/app-bridge": "github:jamlance/app-bridge",
        "better-sqlite3": "^11.5.0",
        "cookie-parser": "^1.4.7",
        express: "^4.19.2",
      },
      devDependencies: {
        "@types/better-sqlite3": "^7.6.11",
        "@types/cookie-parser": "^1.4.7",
        "@types/express": "^4.17.21",
        "@types/node": "^20.11.0",
        typescript: "^5.4.0",
        vite: "^5.2.0",
      },
    },
    null,
    2,
  ),
  "tsconfig.json": JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        strict: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        isolatedModules: true,
        skipLibCheck: true,
        noUncheckedIndexedAccess: true,
        types: ["node", "vite/client"],
      },
      include: ["src/**/*"],
    },
    null,
    2,
  ),
  "vite.config.ts": `import { defineConfig } from "vite";
export default defineConfig({
  server: { host: "0.0.0.0", port: 5173 },
  build: { outDir: "dist", sourcemap: true },
});
`,
  "index.html": `<!doctype html>
<html lang="en" data-brand="${brand}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="/src/index.css" />
  </head>
  <body>
    <div id="root">
      <div class="bv-shell">
        <div class="bv-card">
          <div class="bv-skeleton" style="width: 40%;"></div>
          <div class="bv-skeleton" style="width: 70%; margin-top: 8px;"></div>
        </div>
      </div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
  "src/index.css": `@import "@bookerva-apps/core/styles.css";
`,
  "src/bv-init.ts": fs.readFileSync(
    path.join(ROOT, "apps/currency-dashboard/src/bv-init.ts"),
    "utf8",
  ),
  "src/main.ts": `import "./index.css";
import { initBv, makeToast } from "./bv-init";

(async () => {
  let session;
  try {
    session = await initBv();
  } catch (err: any) {
    document.getElementById("root")!.innerHTML = \`
      <div class="bv-shell"><div class="bv-card" style="text-align:center;">
        <h1>${title} couldn't load</h1>
        <p class="bv-muted">\${err?.message || "Unknown error"}</p>
      </div></div>\`;
    return;
  }
  const toast = makeToast(session.inkress);
  document.getElementById("root")!.innerHTML = \`
    <div class="bv-shell">
      <header class="bv-header">
        <div>
          <h1>${title}</h1>
          <p class="bv-muted">\${session.merchant.name || session.merchant.username || "Merchant"}</p>
        </div>
        <span class="bv-pill">by Bookerva</span>
      </header>
      <div class="bv-card">
        <p>${title} is loading…</p>
      </div>
    </div>\`;
})();
`,
  "server.js": `import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const required = ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(\`[${name}] Missing env: \${missing.join(", ")}\`);
  process.exit(1);
}

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE,
  frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

// TODO: app-specific API endpoints

core.mountSpaFallback();

app.listen(PORT, HOST, () => {
  console.log(\`[${name}] listening on http://\${HOST}:\${PORT}\`);
});
`,
  Dockerfile: `# Multi-stage build for ${title}.
FROM node:20-alpine AS builder
WORKDIR /work
RUN apk add --no-cache git python3 make g++
RUN npm install -g pnpm@9
COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/${name} ./apps/${name}
RUN pnpm install --no-frozen-lockfile
WORKDIR /work/apps/${name}
RUN pnpm exec vite build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache git
COPY --from=builder /work/package.json /work/pnpm-workspace.yaml ./
COPY --from=builder /work/node_modules ./node_modules
COPY --from=builder /work/packages ./packages
COPY --from=builder /work/apps/${name}/package.json ./apps/${name}/package.json
COPY --from=builder /work/apps/${name}/node_modules ./apps/${name}/node_modules
COPY --from=builder /work/apps/${name}/dist ./apps/${name}/dist
COPY apps/${name}/server.js ./apps/${name}/server.js
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/${name}
CMD ["node", "server.js"]
`,
};

for (const [rel, content] of Object.entries(files)) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

console.log(`Scaffolded apps/${name} (${brand})`);
