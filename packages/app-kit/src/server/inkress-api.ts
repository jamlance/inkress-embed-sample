// OAuth token exchange/refresh — SERVER ONLY.
//
// Ported verbatim from packages/core/src/inkress-api.mjs (the proven path) and
// typed. Neither @inkress/admin-sdk nor @inkress/storefront-sdk performs the
// session-JWT exchange — the SDK *consumes* an access token. So app-kit owns
// the OAuth grants here and hands the resulting token to the admin SDK.
//
// Endpoint: POST `${apiBaseUrl}/hooks/oauth/token` (RFC 8693 token-exchange for
// the embedded session JWT; refresh_token grant for offline/public access).

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  /** Token-endpoint base, e.g. `https://api-dev.inkress.com/api/v1`. */
  apiBaseUrl: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  merchant_id?: number;
  expires_in: number;
  token_type?: string;
  [key: string]: unknown;
}

export class InkressApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "InkressApiError";
  }
}

const stripTrailingSlash = (s: string) => (s.endsWith("/") ? s.slice(0, -1) : s);
const tokenUrl = (cfg: OAuthClientConfig) => `${stripTrailingSlash(cfg.apiBaseUrl)}/hooks/oauth/token`;

async function postToken(cfg: OAuthClientConfig, body: URLSearchParams, failCode: string): Promise<TokenResponse> {
  const r = await fetch(tokenUrl(cfg), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) {
    let detail: any;
    try {
      detail = await r.json();
    } catch {
      detail = await r.text();
    }
    throw new InkressApiError(
      detail?.error || `http_${r.status}`,
      detail?.error_description || `${failCode} failed (HTTP ${r.status})`,
    );
  }
  return (await r.json()) as TokenResponse;
}

/** Exchange an embedded dashboard session JWT for a merchant access token. */
export function exchangeSessionToken(
  cfg: OAuthClientConfig,
  sessionJwt: string,
  opts: { scope?: string[] } = {},
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    subject_token: sessionJwt,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
  });
  if (opts.scope?.length) body.set("scope", opts.scope.join(" "));
  return postToken(cfg, body, "Token exchange");
}

/** Refresh-token grant — lets offline/public code act on a merchant's behalf. */
export function refreshAccessToken(cfg: OAuthClientConfig, refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  return postToken(cfg, body, "Refresh");
}

/** Authorization-code grant — the standalone (non-embedded) OAuth redirect flow. */
export function exchangeAuthorizationCode(
  cfg: OAuthClientConfig,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  return postToken(cfg, body, "Authorization-code exchange");
}

/** Decode (NOT verify) a JWT claim. We only need `aud` to pick which client
 *  credentials to present; the API verifies the signature during exchange. */
export function peekClaim<T = unknown>(jwt: string, claim: string): T | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json)[claim] ?? null;
  } catch {
    return null;
  }
}

export const peekAud = (jwt: string) => peekClaim<string>(jwt, "aud");
