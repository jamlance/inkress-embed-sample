// @inkress/app-kit/server — SERVER-ONLY barrel.
//
// Importing this from client/browser code is a bug: it pulls in the client
// secret, the admin SDK, pg, and node:crypto. The scaffolded app only imports
// it from `*.server.*` modules, `entry.server.tsx`, and `server.mjs`; a lint
// rule (Phase 8) enforces that.

// ---- OAuth grants + JWT peek ----
export {
  exchangeSessionToken,
  refreshAccessToken,
  exchangeAuthorizationCode,
  peekAud,
  peekClaim,
  InkressApiError,
} from "./inkress-api";
export type { OAuthClientConfig, TokenResponse } from "./inkress-api";

// ---- environment + CSP ----
export { loadEnv, cspHeaders, applyCspHeaders, DEFAULT_FRAME_ANCESTORS } from "./env";
export type { AppKitEnv } from "./env";

// ---- Postgres backbone + at-rest crypto ----
export { openSchemaPg, safeSchema } from "./pg";
export type { SchemaPg, OpenSchemaOptions } from "./pg";
export { keyFromSecret } from "./crypto";
export type { EncryptionKey } from "./crypto";

// ---- the kit: define, serve, authenticate, webhooks ----
export { defineAppKit } from "./app-kit";
export { createInkressServer } from "./server";
export type { CreateServerOptions, ViteDevServerLike } from "./server";
export { authenticate, requireMerchant, getOptionalMerchant, assertScope } from "./authenticate";
export type { AppKitArgs } from "./authenticate";
export { createWebhookHandler } from "./webhooks";
export type { WebhookEvent, WebhookHandler } from "./webhooks";
export { buildAdmin } from "./admin";
export { resolveContext, bootstrapFromJwt, setSessionCookie, SESSION_COOKIE } from "./context";

// ---- shared types ----
export type { AppKit, AppKitConfig, AppKitRequestContext, MerchantContext, WebhookRegistration } from "./types";
export type { Session } from "./session";

// ---- DDL: the kit's own tables (session / offline tokens / webhook idempotency) ----
import { KIT_SESSION_DDL } from "./session";
import { KIT_TOKENS_DDL } from "./tokens";
import { KIT_WEBHOOK_DDL } from "./storage";
export { KIT_SESSION_DDL, KIT_TOKENS_DDL, KIT_WEBHOOK_DDL };
/** All kit DDL — concat with your app's DDL when opening the schema. */
export const KIT_DDL = [KIT_SESSION_DDL, KIT_TOKENS_DDL, KIT_WEBHOOK_DDL].join("\n");
