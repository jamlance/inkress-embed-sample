#!/usr/bin/env node
/**
 * TRUE end-to-end test — replicates exactly what the browser does,
 * including the header-based session the iframe uses:
 *
 *   1. mint session JWT (signed with the app's whsec_, kid header)
 *   2. POST /__bv/bootstrap  → read session_id from the BODY
 *   3. call a real app API endpoint with X-BV-Session: <session_id>
 *   4. assert real data comes back (not no_session)
 *
 * This is the test that would have caught the third-party-cookie bug.
 *
 *   node scripts/e2e-app.mjs <app_db_id> <app_base_url> <api_path> [merchant_id]
 */

import crypto from "node:crypto";
import pg from "pg";
import { decryptUtilsEncryption } from "./lib/inkress-crypto.mjs";

const DB_URL = process.env.COMMERCE_API_DB_URL || "postgresql://postgres:Sekpak%231@og.rfitzy.net:5432/commerce_api";
const ISSUER = process.env.URL_WEB || "https://dev.inkress.com";
const [, , appDbId, appBaseUrl, apiPath, merchantArg] = process.argv;
const MERCHANT_ID = Number(merchantArg || 183);
if (!appDbId || !appBaseUrl || !apiPath) {
  console.error("Usage: e2e-app.mjs <app_db_id> <app_base_url> <api_path> [merchant_id]");
  process.exit(2);
}

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function sign(payload, secret, kid) {
  const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid }));
  const p = b64url(JSON.stringify(payload));
  const s = b64url(crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest());
  return `${h}.${p}.${s}`;
}

const pool = new pg.Pool({ connectionString: DB_URL });
try {
  const r = await pool.query(
    `SELECT oc.client_id, oc.allowed_scopes, pf.value AS enc
       FROM oauth_clients oc
       JOIN private_fields pf ON pf.record='oauth_clients' AND pf.record_id=oc.id AND pf.name='webhook_secret'
      WHERE oc.id=$1`, [appDbId]);
  if (!r.rows[0]) { console.error("app not found"); process.exit(1); }
  const { client_id, allowed_scopes, enc } = r.rows[0];
  const whsec = decryptUtilsEncryption(enc);
  const now = Math.floor(Date.now() / 1000);
  const jwt = sign({
    iss: ISSUER, aud: client_id, sub: `merchant:${MERCHANT_ID}`, dest: "bookerva-jackjack",
    exp: now + 60, nbf: now, iat: now, jti: crypto.randomBytes(16).toString("hex"),
    merchant_id: MERCHANT_ID, user_id: 90, scopes: allowed_scopes, session_id: crypto.randomUUID(),
  }, whsec, client_id);

  const base = appBaseUrl.replace(/\/$/, "");
  // Step 2: bootstrap
  const boot = await fetch(`${base}/__bv/bootstrap`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionJwt: jwt }),
  });
  const bootBody = await boot.json().catch(() => null);
  if (!boot.ok || !bootBody?.session_id) {
    console.log(`✗ bootstrap failed: HTTP ${boot.status}`, JSON.stringify(bootBody)); process.exit(1);
  }
  console.log(`bootstrap OK — session_id ${bootBody.session_id.slice(0, 8)}… merchant ${bootBody.merchant_id}`);

  // Step 3: real API call with the header
  const api = await fetch(`${base}${apiPath}`, { headers: { "X-BV-Session": bootBody.session_id } });
  const apiBody = await api.json().catch(() => null);
  if (!api.ok) { console.log(`✗ API ${apiPath} failed: HTTP ${api.status}`, JSON.stringify(apiBody)); process.exit(1); }
  const preview = JSON.stringify(apiBody).slice(0, 160);
  console.log(`✓ E2E OK — ${apiPath} returned: ${preview}`);
} finally {
  await pool.end();
}
