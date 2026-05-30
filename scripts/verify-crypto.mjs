#!/usr/bin/env node
/**
 * Verify our Node-side crypto round-trips against the live Elixir
 * encryption by decrypting a known existing private_field. Run once
 * before bulk-registering apps.
 */
import pg from "pg";
import { decryptUtilsEncryption, hashOauthClientSecret } from "./lib/inkress-crypto.mjs";

const DB_URL =
  process.env.COMMERCE_API_DB_URL ||
  "postgresql://postgres:Sekpak%231@og.rfitzy.net:5432/commerce_api";
const PEPPER =
  process.env.OAUTH_CLIENT_SECRET_PEPPER ||
  "1gm++o8+mY9XQfJHgxUPzuczPKsarR/b17LAydg0E2bHit1Bl9SwateOaWmbH8G/";

const pool = new pg.Pool({ connectionString: DB_URL });

try {
  // Pick the existing Sample App's webhook_secret and try to decrypt.
  const r = await pool.query(
    `SELECT pf.value AS enc_whsec, oc.client_id, oc.name
       FROM private_fields pf
       JOIN oauth_clients oc ON oc.id = pf.record_id
      WHERE pf.record = 'oauth_clients' AND pf.name = 'webhook_secret'
      ORDER BY pf.id DESC LIMIT 3`,
  );
  for (const row of r.rows) {
    try {
      const dec = decryptUtilsEncryption(row.enc_whsec);
      console.log(
        `OK  client_id=${row.client_id} name=${row.name} → ${dec.slice(0, 16)}…`,
      );
    } catch (e) {
      console.log(
        `FAIL client_id=${row.client_id} name=${row.name} → ${e.message}`,
      );
    }
  }
} finally {
  await pool.end();
}
console.log(`hash test: ${hashOauthClientSecret("hello", PEPPER).slice(0, 16)}…`);
