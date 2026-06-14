// Typed environment + CSP headers — SERVER ONLY.

import type { InkressMode } from "../index";

export interface AppKitEnv {
  /** App identity → Postgres schema name. From APP_NAME. */
  appName: string;
  /** OAuth client credentials (single-client default; multi-client via defineAppKit). */
  clientId: string;
  clientSecret: string;
  /** Token-endpoint base for the OAuth grants, e.g. https://api-dev.inkress.com/api/v1. */
  apiBaseUrl: string;
  /** Which Inkress host the admin SDK talks to. 'live' | 'sandbox'. */
  mode: InkressMode;
  databaseUrl?: string;
  webhookSecret?: string;
  frameAncestors?: string;
  publicBaseUrl?: string;
  /** Enable the standalone OAuth-redirect path (non-embedded). From STANDALONE. */
  standalone: boolean;
}

const truthy = (v: string | undefined) => v === "1" || v?.toLowerCase() === "true";

/** Read + validate the app's environment. Throws a clear error listing any
 *  missing required vars, so a misconfigured deploy fails fast at boot. */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppKitEnv {
  const required = {
    APP_NAME: env.APP_NAME,
    OAUTH_CLIENT_ID: env.OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET: env.OAUTH_CLIENT_SECRET,
    INKRESS_API_BASE: env.INKRESS_API_BASE,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`[app-kit] missing required env: ${missing.join(", ")}`);
  }
  const mode: InkressMode = (env.MODE || "live").toLowerCase() === "sandbox" ? "sandbox" : "live";
  return {
    appName: required.APP_NAME!,
    clientId: required.OAUTH_CLIENT_ID!,
    clientSecret: required.OAUTH_CLIENT_SECRET!,
    apiBaseUrl: required.INKRESS_API_BASE!,
    mode,
    databaseUrl: env.APPS_DATABASE_URL,
    webhookSecret: env.INKRESS_WEBHOOK_SECRET,
    frameAncestors: env.FRAME_ANCESTORS,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    standalone: truthy(env.STANDALONE),
  };
}

// Who may iframe this app. Ported from packages/core/src/server.mjs.
export const DEFAULT_FRAME_ANCESTORS =
  "https://merchant.inkress.com https://dev.inkress.com https://dev.commerce.webapps.host https://*.commerce.webapps.host";

/** The security headers an embedded app must send on every document response.
 *  Stamped in entry.server (and on the Express layer by createInkressServer). */
export function cspHeaders(frameAncestors: string = DEFAULT_FRAME_ANCESTORS): Record<string, string> {
  return {
    "Content-Security-Policy": `frame-ancestors ${frameAncestors}`,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "clipboard-write=(self)",
  };
}

/** Apply {@link cspHeaders} onto a Fetch `Headers` (used in entry.server.tsx). */
export function applyCspHeaders(headers: Headers, frameAncestors?: string): void {
  for (const [k, v] of Object.entries(cspHeaders(frameAncestors))) headers.set(k, v);
}
