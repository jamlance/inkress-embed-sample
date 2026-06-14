// The AppKit singleton — wired once, imported by server.mjs (Node) and by every
// loader/action (Vite). Plain ESM so both runtimes share the same instance.
import {
  defineAppKit,
  loadEnv,
  openSchemaPg,
  keyFromSecret,
  createWebhookHandler,
  KIT_DDL,
} from "@inkress/app-kit/server";
import { MemorySessionStorage, PgSessionStorage } from "@inkress/app-kit/server/session";
import { createDrizzleStorage } from "@inkress/app-kit/server/storage";
import { openMerchantTokens } from "@inkress/app-kit/server/tokens";
import * as schema from "../db/schema.server.mjs";

const env = loadEnv();

// One schema-pinned pool backs the session store, token store, and app data.
// Omit APPS_DATABASE_URL to run with an in-memory session store (no persistence).
const db = env.databaseUrl
  ? openSchemaPg(env.appName, { ddl: KIT_DDL + "\n" + schema.APP_DDL, connectionString: env.databaseUrl })
  : null;

// Kick off schema creation (non-blocking — top-level await breaks the client
// build). Server code that uses Drizzle directly should `await storage.raw.ensure()`
// (memoized, idempotent) so tables exist even before any session has run.
if (db) db.ensure().catch((e) => console.error("[app-kit] schema ensure:", e?.message));

const sessionStorage = db
  ? new PgSessionStorage(db, { encryptionKey: keyFromSecret(env.clientSecret) })
  : new MemorySessionStorage();
const storage = db ? createDrizzleStorage(db, schema) : undefined;
const tokens = db
  ? openMerchantTokens(db, { clientId: env.clientId, clientSecret: env.clientSecret, apiBaseUrl: env.apiBaseUrl })
  : undefined;

export const appKit = defineAppKit({
  appName: env.appName,
  clientId: env.clientId,
  clientSecret: env.clientSecret,
  apiBaseUrl: env.apiBaseUrl,
  mode: env.mode,
  sessionStorage,
  storage,
  tokens,
  webhookSecret: env.webhookSecret,
  frameAncestors: env.frameAncestors,
  publicBaseUrl: env.publicBaseUrl,
  standalone: env.standalone,
  scopes: [
    "orders:read",
    "orders:write",
    "products:read",
    "merchant_profile:read",
    "offline_access",
    "webhooks:manage",
  ],
});

// Re-export the server auth helpers so routes import them from THIS `.server`
// module — the `.server.mjs` suffix guarantees RR7 strips it from the client
// bundle, so no secret/admin-sdk/pg code can ever leak to the browser.
export {
  requireMerchant,
  getOptionalMerchant,
  assertScope,
  bootstrapFromJwt,
  exchangeAuthorizationCode,
} from "@inkress/app-kit/server";

// Inbound webhook handler (mounted at /webhooks/inkress/:merchantId by server.mjs).
export const webhookHandler = createWebhookHandler(appKit, async (evt) => {
  if (evt.topic === "order_paid" || evt.topic === "order_confirmed") {
    // Act AS the merchant with the offline token, e.g.:
    //   const admin = await evt.admin();
    //   await admin.orders.update(...)
    console.log(`[webhook] ${evt.topic} · merchant ${evt.merchantId} · ${evt.id}`);
  }
});
