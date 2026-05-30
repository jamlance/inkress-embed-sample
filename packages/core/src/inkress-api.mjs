// Plain-JS twin of inkress-api.ts. Apps import the .mjs directly so
// the runtime container doesn't need a TS compiler / loader.

export async function exchangeSessionToken(cfg, sessionJwt, opts = {}) {
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
    let detail;
    try {
      detail = await r.json();
    } catch {
      detail = await r.text();
    }
    throw new InkressApiError(
      detail?.error || `http_${r.status}`,
      detail?.error_description || `Token exchange failed (HTTP ${r.status})`,
    );
  }
  return await r.json();
}

export async function inkressApi(cfg, accessToken, path, init = {}) {
  const url = `${stripTrailingSlash(cfg.apiBaseUrl)}/${stripLeadingSlash(path)}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!r.ok) {
    let detail = null;
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
  return await r.json();
}

export class InkressApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "InkressApiError";
  }
}

function stripTrailingSlash(s) {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
function stripLeadingSlash(s) {
  return s.startsWith("/") ? s.slice(1) : s;
}
