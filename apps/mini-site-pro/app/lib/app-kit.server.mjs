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
import { createAwsBlobStore } from "@inkress/app-kit/server/services";
import { InkressSDK } from "@inkress/admin-sdk";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.server.mjs";

const env = loadEnv();

// One schema-pinned pool backs the session store, token store, and app data.
const db = env.databaseUrl
  ? openSchemaPg(env.appName, { ddl: KIT_DDL + "\n" + schema.APP_DDL, connectionString: env.databaseUrl })
  : null;

// Kick off schema creation (non-blocking — no top-level await, which the client
// build can't transpile). Public routes that use Drizzle (storefront/checkout)
// `await appKit.storage.raw.ensure()` to be sure tables exist; ensure() is
// memoized so this is idempotent.
if (db) db.ensure().catch((e) => console.error("[mini-site-pro] schema ensure:", e?.message));

const sessionStorage = db
  ? new PgSessionStorage(db, { encryptionKey: keyFromSecret(env.clientSecret) })
  : new MemorySessionStorage();
const storage = db ? createDrizzleStorage(db, schema) : undefined;
const tokens = db
  ? openMerchantTokens(db, { clientId: env.clientId, clientSecret: env.clientSecret, apiBaseUrl: env.apiBaseUrl })
  : undefined;

/** S3 blob store for product/brand image uploads (no-op if AWS env absent). */
export const blob = createAwsBlobStore();

/** An admin SDK acting AS a merchant via the stored offline refresh token —
 *  for the public checkout (no live session). */
export async function merchantAdmin(merchantId) {
  if (!tokens) throw new Error("offline tokens not configured");
  const accessToken = await tokens.accessTokenFor(merchantId);
  return new InkressSDK({ accessToken, mode: env.mode });
}

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
    "customers:write",
    "offline_access",
    "webhooks:manage",
  ],
});

// Re-export server auth helpers so routes import them from THIS `.server` module
// (the `.server.mjs` suffix guarantees RR7 strips it from the client bundle).
export {
  requireMerchant,
  getOptionalMerchant,
  assertScope,
  bootstrapFromJwt,
  exchangeAuthorizationCode,
} from "@inkress/app-kit/server";
export { decodeDataUrl, isAllowedImage } from "@inkress/app-kit/server/services";

// Inbound webhook (mounted at /webhooks/inkress/:merchantId). Reconciles a
// storefront order to "paid" when Inkress reports payment.
export const webhookHandler = createWebhookHandler(appKit, async (evt) => {
  if (!/paid|confirmed/i.test(evt.topic)) return;
  const ev = evt.payload?.event || {};
  const order = ev.data?.order || ev.data || {};
  const inkressOrderId = order.id != null ? String(order.id) : null;
  if (!inkressOrderId || !storage) return;
  await storage.db.update(schema.orders).set({ state: "paid" }).where(eq(schema.orders.inkressOrderId, inkressOrderId));
  console.log(`[webhook] ${evt.topic} → order ${inkressOrderId} marked paid`);
});
