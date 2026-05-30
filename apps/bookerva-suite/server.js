// bookerva-suite — the Inkress merchant's "Bookings" Marketplace app.
//
// The whole product surface (services, appointments, public booking page) is
// owned by Bookerva. This app stays small: it sits in Inkress's iframe-app
// contract, mints a short-lived HS256 identity token carrying the merchant's
// profile, and hands the browser a deep-link into Bookerva's /embed/{vertical}.
// See docs/inkress-embedding-and-verticals.md §13 in the bookerva repo for the
// JWT shape Bookerva expects.

import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

for (const k of [
  "INKRESS_API_BASE",
  "SERVICE_TOKEN_SECRET",
  "BOOKERVA_BASE_URL",
]) {
  if (!process.env[k]) {
    console.error(`[bookerva-suite] Missing env: ${k}`);
    process.exit(1);
  }
}

const SECRET = process.env.SERVICE_TOKEN_SECRET;
const BOOKERVA_BASE_URL = String(process.env.BOOKERVA_BASE_URL).replace(
  /\/+$/,
  "",
);

// OAuth clients. Accept either the multi-client OAUTH_CLIENTS
// ("client_id:client_secret;client_id:client_secret") or the singular pair
// the rest of the repo uses (OAUTH_CLIENT_ID + OAUTH_CLIENT_SECRET) — both
// land in the same map shape so mountAppCore is happy either way.
const clients = {};
if (process.env.OAUTH_CLIENTS) {
  for (const pair of process.env.OAUTH_CLIENTS.split(/[;,]/)) {
    const [id, secret] = pair.split(":");
    if (id && secret) clients[id.trim()] = secret.trim();
  }
}
if (process.env.OAUTH_CLIENT_ID && process.env.OAUTH_CLIENT_SECRET) {
  clients[process.env.OAUTH_CLIENT_ID] = process.env.OAUTH_CLIENT_SECRET;
}
if (!Object.keys(clients).length) {
  console.error(
    "[bookerva-suite] No OAuth client credentials. Set OAUTH_CLIENTS or OAUTH_CLIENT_ID + OAUTH_CLIENT_SECRET.",
  );
  process.exit(1);
}

const app = express();
const core = mountAppCore(app, {
  clients,
  clientId: Object.keys(clients)[0],
  apiBaseUrl: process.env.INKRESS_API_BASE,
  frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

// ---- HS256 identity token ---------------------------------------------------
//
// Same shape as packages/core/src/bookerva-client.mjs's signServiceToken, plus
// the optional `profile` claim Bookerva's URL bootstrap reads to provision a
// fresh tenant without an out-of-band POST.
function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signBookervaIdentityToken(externalId, profile) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256" };
  const payload = {
    scope: "partner",
    source: "inkress",
    externalId: String(externalId),
    profile,
    iss: "bookerva",
    aud: "bookerva-partner",
    iat: now,
    // Short enough that a leaked URL token expires before it's useful;
    // long enough that a slow iframe load + retry still works.
    exp: now + 15 * 60,
    jti: crypto.randomUUID(),
  };
  const signingInput =
    b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  const sig = b64url(
    crypto.createHmac("sha256", SECRET).update(signingInput).digest(),
  );
  return signingInput + "." + sig;
}

// ---- /api/bookerva-url ------------------------------------------------------
//
// Browser-side calls this once after initBv(), then sets <iframe src>. We
// always mint a fresh JWT — Bookerva swaps it for a `bes_…` session that the
// fetch interceptor in its embed shell takes over with from that point on.
app.get("/api/bookerva-url", core.requireSession, (req, res) => {
  const m = req.session?.data?.merchant;
  if (!m || !m.id) {
    return res.status(404).json({
      error: "no_merchant",
      message: "Session is missing merchant context.",
    });
  }

  const vertical = String(req.query.vertical || "generic");

  // Profile claims travel inside the JWT so Bookerva can provision a tenant
  // for first-time merchants without a separate POST /api/v1/partner/session.
  const profile = {
    name: m.name || m.username || `Inkress Merchant ${m.id}`,
    email:
      m.email ||
      (m.username
        ? `${m.username}@inkress.local`
        : `inkress-merchant-${m.id}@inkress.local`),
    timezone: m.timezone || "America/Jamaica",
    currency_code: m.currency_code || m.currency?.code || "JMD",
    locale: m.locale || "en-JM",
  };

  const jwt = signBookervaIdentityToken(m.id, profile);
  res.json({
    url: `${BOOKERVA_BASE_URL}/embed/${encodeURIComponent(vertical)}?t=${encodeURIComponent(jwt)}`,
    vertical,
  });
});

// SPA fallback — same as every other app in the monorepo.
core.mountSpaFallback();

app.listen(PORT, HOST, () => {
  console.log(`[bookerva-suite] listening on ${HOST}:${PORT}`);
  console.log(`[bookerva-suite] BOOKERVA_BASE_URL=${BOOKERVA_BASE_URL}`);
});
