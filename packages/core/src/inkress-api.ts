/**
 * Inkress API client for embedded apps — server-side.
 *
 * The browser receives a session JWT. The browser sends that JWT to
 * THIS server. THIS server exchanges it (server-side, with the app's
 * client_secret in env) for an inka_ access token. The access token
 * stays on the server, keyed by the session JWT's `jti` (or the
 * merchant_id, depending on caller policy). The browser never sees
 * the access token, so the app's `client_secret` is never exposed.
 *
 * Standard pattern for every Bookerva / Marketplace app — they all
 * import this module instead of reimplementing the dance.
 */

export interface InkressClientConfig {
  /** OAuth client_id (inkid_…). */
  clientId: string;
  /** OAuth client_secret. Server-side only — never ship to browser. */
  clientSecret: string;
  /** Base URL of the Inkress API, e.g. `https://api-dev.inkress.com/api/v1`. */
  apiBaseUrl: string;
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  merchant_id?: number;
}

/**
 * Exchange a session JWT for an `inka_` access token via RFC 8693.
 * The caller (typically an Express handler) verifies the JWT first.
 */
export async function exchangeSessionToken(
  cfg: InkressClientConfig,
  sessionJwt: string,
  opts: { scope?: string[] } = {},
): Promise<AccessTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    subject_token: sessionJwt,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
  });
  if (opts.scope?.length) body.set("scope", opts.scope.join(" "));

  const tokenUrl = `${stripTrailingSlash(cfg.apiBaseUrl)}/hooks/oauth/token`;
  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) {
    let detail: any = await r.text();
    try {
      detail = JSON.parse(detail);
    } catch {
      /* leave as text */
    }
    throw new InkressApiError(
      detail?.error || `http_${r.status}`,
      detail?.error_description || `Token exchange failed (HTTP ${r.status})`,
    );
  }
  return (await r.json()) as AccessTokenResponse;
}

/**
 * Generic Inkress API call. Pass an inka_ access token and the path
 * (e.g. "orders"). Returns the parsed response body.
 *
 * The path is appended to apiBaseUrl. Use leading slash optional —
 * we normalise.
 */
export async function inkressApi<T = any>(
  cfg: Pick<InkressClientConfig, "apiBaseUrl">,
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${stripTrailingSlash(cfg.apiBaseUrl)}/${stripLeadingSlash(path)}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!r.ok) {
    let detail: any = null;
    try {
      detail = await r.json();
    } catch {
      detail = await r.text();
    }
    throw new InkressApiError(
      detail?.result?.reason || `http_${r.status}`,
      detail?.result?.message ||
        (typeof detail?.result === "string" ? detail.result : null) ||
        `Inkress API call failed (HTTP ${r.status}) ${path}`,
    );
  }
  return (await r.json()) as T;
}

export class InkressApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "InkressApiError";
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
function stripLeadingSlash(s: string): string {
  return s.startsWith("/") ? s.slice(1) : s;
}
