// Shared server types — SERVER ONLY.
// Type-only module (no runtime), so impl files can import these without cycles.

import type { InkressSDK } from "@inkress/admin-sdk";
import type { Merchant, BvUser, Scope, InkressMode } from "../index";
import type { OAuthClientConfig } from "./inkress-api";
import type { SessionStorage, Session } from "./session";
import type { StorageAdapter } from "./storage";
import type { MerchantTokenStore } from "./tokens";

/** A webhook topic the app handles (registered on bootstrap when supported). */
export interface WebhookRegistration {
  topic: string;
}

export interface AppKitConfig {
  /** App identity → Postgres schema. */
  appName: string;
  /** Default OAuth client. */
  clientId: string;
  clientSecret: string;
  /** Multi-client suite: aud (client_id) → client_secret. Falls back to the default pair. */
  clients?: Record<string, string>;
  /** Token-endpoint base, e.g. https://api-dev.inkress.com/api/v1. */
  apiBaseUrl: string;
  /** Which Inkress host the admin SDK talks to. */
  mode: InkressMode;
  /** Online session storage (required). */
  sessionStorage: SessionStorage;
  /** App data + webhook idempotency (optional — apps with no DB can omit). */
  storage?: StorageAdapter;
  /** Offline merchant refresh tokens, for webhooks/public (optional). */
  tokens?: MerchantTokenStore;
  /** HMAC secret for inbound webhook verification. */
  webhookSecret?: string;
  /** Topics the app handles. */
  webhooks?: WebhookRegistration[];
  /** Scopes requested on the token exchange (must include offline_access for tokens). */
  scopes?: Scope[];
  frameAncestors?: string;
  publicBaseUrl?: string;
  /** Enable the standalone OAuth-redirect path (non-embedded). */
  standalone?: boolean;
}

export interface AppKit {
  config: AppKitConfig;
  /** Pick the OAuth client credentials matching a session JWT's `aud`. */
  cfgFor(aud?: string | null): OAuthClientConfig;
  sessionStorage: SessionStorage;
  storage?: StorageAdapter;
  tokens?: MerchantTokenStore;
}

/** What `authenticate.merchant` returns — the authenticated SDK + identity. */
export interface MerchantContext {
  /** Authenticated admin SDK, ready to call (orders, products, merchants, …). */
  admin: InkressSDK;
  merchant: Merchant;
  merchantId: number;
  scopes: Scope[];
  /** The acting dashboard user (from X-BV-User-* headers / consenting JWT). */
  user: BvUser;
  session: Session;
}

/**
 * Resolved once per request in the Express→RR7 `getLoadContext`; every loader /
 * action reads it via `args.context`. Carries the session (or null) + identity;
 * `authenticate.*` turns it into a MerchantContext (or throws/redirects).
 */
export interface AppKitRequestContext {
  appKit: AppKit;
  session: Session | null;
  merchant: Merchant | null;
  user: BvUser;
  scopes: Scope[];
  /** On first-load bootstrap: the session id the client must stash for the header carrier. */
  bootstrap?: { sessionId: string };
}
