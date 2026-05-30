#!/usr/bin/env node
/**
 * End-to-end verification of one deployed app's full data path:
 *
 *   craft session JWT (signed with the app's whsec_)
 *     → POST /__bv/bootstrap on the app
 *       → app exchanges JWT for inka_ token (RFC 8693)
 *         → app calls Inkress merchants/:id
 *           → returns merchant identity
 *
 * If this returns merchant data, the whole chain works: session
 * minting, token exchange, consent check, and live Inkress reads.
 *
 *   node scripts/verify-app.mjs <app_db_id> <app_base_url>
 *
 * Reads client_id + whsec_ from the DB for <app_db_id>.
 */

import crypto from "node:crypto";
import pg from "pg";
import { decryptUtilsEncryption } from "./lib/inkress-crypto.mjs";

const DB_URL =
  process.env.COMMERCE_API_DB_URL ||
  "postgresql://postgres:Sekpak%231@og.rfitzy.net:5432/commerce_api";
const ISSUER = process.env.URL_WEB || "https://dev.inkress.com";
const MERCHANT_ID = Number(process.argv[4] || 183);

const [, , appDbId, appBaseUrl] = process.argv;
if (!appDbId || !appBaseUrl) {
  console.error("Usage: verify-app.mjs <app_db_id> <app_base_url> [merchant_id]");
  process.exit(2);
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signHs256(payload, secret, kid) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = b64url(crypto.createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

const pool = new pg.Pool({ connectionString: DB_URL });
try {
  const r = await pool.query(
    `SELECT oc.client_id, oc.allowed_scopes, pf.value AS enc_whsec
       FROM oauth_clients oc
       JOIN private_fields pf ON pf.record = 'oauth_clients' AND pf.record_id = oc.id AND pf.name = 'webhook_secret'
      WHERE oc.id = $1`,
    [appDbId],
  );
  if (!r.rows[0]) { console.error("App not found"); process.exit(1); }
  const { client_id, allowed_scopes, enc_whsec } = r.rows[0];
  const whsec = decryptUtilsEncryption(enc_whsec);

  const now = Math.floor(Date.now() / 1000);
  const jwt = signHs256(
    {
      iss: ISSUER,
      aud: client_id,
      sub: `merchant:${MERCHANT_ID}`,
      dest: "bookerva-jackjack",
      exp: now + 60,
      nbf: now,
      iat: now,
      jti: crypto.randomBytes(16).toString("hex"),
      merchant_id: MERCHANT_ID,
      user_id: 90,
      scopes: allowed_scopes,
      session_id: crypto.randomUUID(),
    },
    whsec,
    client_id,
  );

  const resp = await fetch(`${appBaseUrl.replace(/\/$/, "")}/__bv/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionJwt: jwt }),
  });
  const body = await resp.json().catch(() => null);
  console.log(`HTTP ${resp.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (resp.ok && body?.merchant_id) {
    console.log(`\n✓ FULL CHAIN OK — exchanged + read merchant ${body.merchant_id} (${body.merchant?.name || body.merchant?.username || "?"})`);
  } else {
    console.log(`\n✗ chain failed`);
    process.exit(1);
  }
} finally {
  await pool.end();
}
