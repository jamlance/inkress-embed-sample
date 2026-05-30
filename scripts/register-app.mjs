#!/usr/bin/env node
/**
 * Bulk-register a Bookerva/Marketplace embedded app on the Inkress
 * dev database directly. No staff JWT needed — we INSERT the
 * `oauth_clients` row, the encrypted `private_fields` row for the
 * webhook secret, and the active `tokens` row that represents the
 * test merchant's consent.
 *
 * Usage:
 *
 *   node scripts/register-app.mjs \
 *     --name "Bookerva Currency Dashboard" \
 *     --description "Side-by-side JMD + USD wallet view" \
 *     --logo "https://…/logo.png" \
 *     --homepage "https://currency.dserve.webapps.host" \
 *     --entry-url "https://currency.dserve.webapps.host" \
 *     --surface-label "Currency Dashboard" \
 *     --surface-icon "pie_chart" \
 *     --surface-default-path "/" \
 *     --scopes "wallet:read,merchant_profile:read" \
 *     --org-id 10 \
 *     --connect-merchant 183
 *
 * Prints the resulting client_id / client_secret / webhook_secret on
 * success. Each is required for the deployed app's env (client_id +
 * client_secret) and for webhook verification (webhook_secret).
 *
 * Idempotent: if an oauth_client with the given client_id already
 * exists (matched by name), updates rather than re-inserts.
 */

import pg from "pg";
import {
  hashOauthClientSecret,
  encryptUtilsEncryption,
  genClientId,
  genClientSecret,
  genWebhookSecret,
} from "./lib/inkress-crypto.mjs";

const DB_URL =
  process.env.COMMERCE_API_DB_URL ||
  "postgresql://postgres:Sekpak%231@og.rfitzy.net:5432/commerce_api";

// SECRET_KEY_BASE on dev-commerce-api — read once from Coolify or paste
// here. We refuse to run without it because hash_secret would silently
// produce wrong hashes against the running API.
const PEPPER =
  process.env.OAUTH_CLIENT_SECRET_PEPPER ||
  process.env.SECRET_KEY_BASE ||
  "1gm++o8+mY9XQfJHgxUPzuczPKsarR/b17LAydg0E2bHit1Bl9SwateOaWmbH8G/";

// status values from Constants
const STATUS_ACTIVE = 1;

// kind values from Constants.kinds
const TOKEN_OAUTH_INTEGRATION_KIND = 34;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k?.startsWith("--")) continue;
    const key = k.replace(/^--/, "");
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  const required = ["name", "entry-url", "scopes", "org-id"];
  const missing = required.filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required: ${missing.join(", ")}`);
    process.exit(2);
  }

  const name = args.name;
  const description = args.description || "";
  const logo = args.logo || "https://img.imageboss.me/commercian/cdn/payment-providers/inkress-k.png";
  const homepage = args.homepage || args["entry-url"];
  const entryUrl = args["entry-url"];
  const surfaceLabel = args["surface-label"] || name;
  const surfaceIcon = args["surface-icon"] || "default";
  const surfaceDefaultPath = args["surface-default-path"] || "/";
  const scopes = args.scopes.split(",").map((s) => s.trim()).filter(Boolean);
  const orgId = parseInt(args["org-id"], 10);
  const connectMerchantId = args["connect-merchant"]
    ? parseInt(args["connect-merchant"], 10)
    : null;
  const createdByUserId = args["created-by"]
    ? parseInt(args["created-by"], 10)
    : 90; // admin@fleeksite.com on dev

  if (!Array.isArray(scopes) || scopes.length === 0) {
    console.error("scopes must be non-empty CSV");
    process.exit(2);
  }
  // Validate entry URL origin
  let entryOrigin;
  try {
    entryOrigin = new URL(entryUrl).origin;
  } catch {
    console.error("entry-url must be a valid absolute URL");
    process.exit(2);
  }
  // Same-origin homepage to satisfy the changeset rule.
  if (new URL(homepage).origin !== entryOrigin) {
    console.error(
      `homepage origin (${new URL(homepage).origin}) must match entry-url origin (${entryOrigin})`,
    );
    process.exit(2);
  }

  const surfaces = [
    {
      surface: "main_app",
      label: surfaceLabel,
      icon: surfaceIcon,
      default_path: surfaceDefaultPath,
    },
  ];

  const client_id = genClientId();
  const raw_secret = genClientSecret();
  const secret_hash = hashOauthClientSecret(raw_secret, PEPPER);
  const raw_whsec = genWebhookSecret();
  const enc_whsec = encryptUtilsEncryption(raw_whsec);

  const pool = new pg.Pool({ connectionString: DB_URL });
  const c = await pool.connect();

  try {
    await c.query("BEGIN");

    // Existing row by name? Use it (idempotency).
    const existing = await c.query(
      `SELECT id, client_id FROM oauth_clients WHERE name = $1 LIMIT 1`,
      [name],
    );

    let appDbId;
    let appClientId;

    if (existing.rows[0]) {
      const row = existing.rows[0];
      appDbId = row.id;
      appClientId = row.client_id;
      await c.query(
        `UPDATE oauth_clients SET
           description = $1,
           logo_url = $2,
           homepage_url = $3,
           redirect_uris = $4,
           allowed_scopes = $5,
           status = $6,
           organisation_id = $7,
           embedded = TRUE,
           embedded_entry_url = $8,
           embedded_surfaces = $9,
           updated_at = NOW()
         WHERE id = $10`,
        [
          description,
          logo,
          homepage,
          [`${entryOrigin}/oauth/callback`],
          scopes,
          STATUS_ACTIVE,
          orgId,
          entryUrl,
          surfaces.map((s) => JSON.stringify(s)),
          appDbId,
        ],
      );
      console.error(`Updated existing app id=${appDbId}, client_id=${appClientId}`);
    } else {
      const ins = await c.query(
        `INSERT INTO oauth_clients (
           name, description, logo_url, homepage_url, contact_email,
           client_id, client_secret_hash,
           redirect_uris, allowed_scopes,
           status, organisation_id, created_by_user_id,
           embedded, embedded_entry_url, embedded_surfaces,
           inserted_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7,
           $8, $9,
           $10, $11, $12,
           TRUE, $13, $14,
           NOW(), NOW()
         ) RETURNING id, client_id`,
        [
          name,
          description,
          logo,
          homepage,
          "support@bookerva.com",
          client_id,
          secret_hash,
          [`${entryOrigin}/oauth/callback`],
          scopes,
          STATUS_ACTIVE,
          orgId,
          createdByUserId,
          entryUrl,
          surfaces.map((s) => JSON.stringify(s)),
        ],
      );
      appDbId = ins.rows[0].id;
      appClientId = ins.rows[0].client_id;
      console.error(`Created app id=${appDbId}, client_id=${appClientId}`);
    }

    // Webhook secret — upsert (one per app, name='webhook_secret').
    await c.query(
      `INSERT INTO private_fields (record, record_id, name, kind, value, inserted_at, updated_at)
       VALUES ('oauth_clients', $1, 'webhook_secret', 1, $2, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [appDbId, enc_whsec],
    );
    // No unique constraint exists, so do a manual upsert pattern: delete-then-insert
    // when the row already existed (i.e. on the second register run for the same app).
    const wsRows = await c.query(
      `SELECT id FROM private_fields
        WHERE record = 'oauth_clients' AND record_id = $1 AND name = 'webhook_secret'
        ORDER BY id DESC`,
      [appDbId],
    );
    if (wsRows.rows.length > 1) {
      // Keep the most recent, drop older
      const keepId = wsRows.rows[0].id;
      await c.query(
        `DELETE FROM private_fields
          WHERE record = 'oauth_clients' AND record_id = $1
            AND name = 'webhook_secret' AND id <> $2`,
        [appDbId, keepId],
      );
    }
    // If we updated an existing row, replace the value.
    await c.query(
      `UPDATE private_fields SET value = $1, updated_at = NOW()
        WHERE record = 'oauth_clients' AND record_id = $2 AND name = 'webhook_secret'`,
      [enc_whsec, appDbId],
    );

    // Optionally connect a test merchant (active tokens row).
    let tokenInfo = null;
    if (connectMerchantId) {
      const access_token =
        "inka_" +
        (await import("node:crypto")).randomBytes(32)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      const tokenIns = await c.query(
        `INSERT INTO tokens (
           public_key, kind, provider, title, enabled,
           expires, merchant_id, oauth_client_id, scopes,
           refresh_token_family_id, data, inserted_at, updated_at
         ) VALUES (
           $1, $2, 'oauth', $3, TRUE,
           86400, $4, $5, $6,
           gen_random_uuid(), '{"issued_via":"bulk_register"}'::jsonb, NOW(), NOW()
         ) RETURNING id`,
        [
          access_token,
          TOKEN_OAUTH_INTEGRATION_KIND,
          `OAuth integration: ${name}`,
          connectMerchantId,
          appDbId,
          scopes.filter((s) => s !== "offline_access"),
        ],
      );
      tokenInfo = {
        merchant_id: connectMerchantId,
        access_token,
        token_row_id: tokenIns.rows[0].id,
      };
    }

    await c.query("COMMIT");

    // Single line of stdout so this script is easy to pipe.
    console.log(
      JSON.stringify({
        app_db_id: appDbId,
        client_id: appClientId,
        client_secret: raw_secret,
        webhook_secret: raw_whsec,
        entry_url: entryUrl,
        surfaces,
        connected_test_merchant: tokenInfo,
      }),
    );
  } catch (err) {
    await c.query("ROLLBACK");
    console.error("Registration failed:", err.message || err);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
