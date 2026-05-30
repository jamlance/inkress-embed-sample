/**
 * In-memory session store for embedded-app servers.
 *
 * Maps an opaque session-id (cookie) → cached Inkress access token +
 * merchant context. The access token never leaves this server; the
 * browser only ever sees the opaque session-id.
 *
 * Sessions auto-expire shortly before the underlying access token's
 * exp, so the next browser call triggers a refresh from a fresh
 * session JWT rather than a 401 from Inkress.
 *
 * Single-process by design — these are small apps with low traffic.
 * Swap for Redis if any app outgrows it.
 */

import crypto from "node:crypto";
import type { AccessTokenResponse } from "./inkress-api.js";

export interface SessionEntry {
  sessionId: string;
  accessToken: string;
  refreshToken?: string;
  scope: string[];
  merchantId: number;
  /** Unix seconds. We refresh before this. */
  expiresAt: number;
  /** Free-form context stashed by the app. */
  data: Record<string, unknown>;
}

export class SessionStore {
  private map = new Map<string, SessionEntry>();
  private sweepHandle?: ReturnType<typeof setInterval>;

  constructor(opts: { sweepEverySec?: number } = {}) {
    const sweepEverySec = opts.sweepEverySec ?? 60;
    this.sweepHandle = setInterval(() => this.sweep(), sweepEverySec * 1000);
    // Don't keep the process alive just for the sweep.
    if (this.sweepHandle && typeof this.sweepHandle === "object") {
      const h = this.sweepHandle as unknown as { unref?: () => void };
      h.unref?.();
    }
  }

  put(token: AccessTokenResponse): SessionEntry {
    const sessionId = crypto.randomUUID();
    const entry: SessionEntry = {
      sessionId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scope: (token.scope || "").split(" ").filter(Boolean),
      merchantId: token.merchant_id ?? 0,
      // Refresh 60s before the API token actually expires.
      expiresAt: Math.floor(Date.now() / 1000) + Math.max(60, token.expires_in - 60),
      data: {},
    };
    this.map.set(sessionId, entry);
    return entry;
  }

  get(sessionId: string | undefined): SessionEntry | null {
    if (!sessionId) return null;
    const entry = this.map.get(sessionId);
    if (!entry) return null;
    if (entry.expiresAt < Math.floor(Date.now() / 1000)) {
      this.map.delete(sessionId);
      return null;
    }
    return entry;
  }

  delete(sessionId: string | undefined): void {
    if (sessionId) this.map.delete(sessionId);
  }

  private sweep(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, entry] of this.map) {
      if (entry.expiresAt < now) this.map.delete(id);
    }
  }

  /** Test helper. */
  size(): number {
    return this.map.size;
  }

  destroy(): void {
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    this.map.clear();
  }
}

/**
 * Cookie name we use universally across apps so the same browser
 * session works without per-app config. Each app's domain isolates
 * the cookie naturally.
 */
export const SESSION_COOKIE = "bv_app_session";
