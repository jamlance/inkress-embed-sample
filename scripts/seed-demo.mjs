#!/usr/bin/env node
/**
 * Seed a few demo records into each deployed app via its real API
 * (bootstrap → POST with X-BV-Session). This proves the write path
 * end-to-end AND makes every app render populated instead of empty
 * when first opened.
 *
 * NOTE: app SQLite lives on the container filesystem (no persistent
 * volume yet), so a redeploy clears it. Re-run this after any redeploy.
 *
 *   node scripts/seed-demo.mjs
 */

import crypto from "node:crypto";
import pg from "pg";
import { decryptUtilsEncryption } from "./lib/inkress-crypto.mjs";

const DB_URL = process.env.COMMERCE_API_DB_URL || "postgresql://postgres:Sekpak%231@og.rfitzy.net:5432/commerce_api";
const ISSUER = process.env.URL_WEB || "https://dev.inkress.com";
const MERCHANT = 183;
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sign = (payload, secret, kid) => {
  const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid }));
  const p = b64url(JSON.stringify(payload));
  const s = b64url(crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest());
  return `${h}.${p}.${s}`;
};

const pool = new pg.Pool({ connectionString: DB_URL });

async function sessionFor(appDbId) {
  const r = await pool.query(
    `SELECT oc.client_id, oc.allowed_scopes, pf.value AS enc FROM oauth_clients oc
       JOIN private_fields pf ON pf.record='oauth_clients' AND pf.record_id=oc.id AND pf.name='webhook_secret'
      WHERE oc.id=$1`, [appDbId]);
  const { client_id, allowed_scopes, enc } = r.rows[0];
  const whsec = decryptUtilsEncryption(enc);
  const now = Math.floor(Date.now() / 1000);
  return { client_id, jwt: sign({
    iss: ISSUER, aud: client_id, sub: `merchant:${MERCHANT}`, dest: "bookerva-jackjack",
    exp: now + 60, nbf: now, iat: now, jti: crypto.randomBytes(16).toString("hex"),
    merchant_id: MERCHANT, user_id: 90, scopes: allowed_scopes, session_id: crypto.randomUUID(),
  }, whsec, client_id) };
}

async function bootstrap(base, jwt) {
  const r = await fetch(`${base}/__bv/bootstrap`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionJwt: jwt }) });
  const b = await r.json();
  if (!b?.session_id) throw new Error("bootstrap_no_session");
  return b.session_id;
}
async function post(base, sid, path, body) {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-BV-Session": sid }, body: JSON.stringify(body) });
  return r.ok;
}

const H = (u) => `https://${u}.dserve.webapps.host`;

// [app_db_id, host, [ [path, body], ... ]]
const SEEDS = [
  [4, "to0o0os0ock8sskk8w0cgk4o", [
    ["/api/codes", { code: "WELCOME10", kind: "percent", value: 10, max_uses: 100 }],
    ["/api/codes", { code: "FREESHIP", kind: "fixed", value: 500, min_order: 5000 }],
  ]],
  [5, "es4080ocsooc4ss4kwgowksw", [
    ["/api/expenses", { category: "Rent", amount: 45000, currency: "JMD", spent_on: new Date().toISOString().slice(0,10) }],
    ["/api/expenses", { category: "Utilities", amount: 12500, currency: "JMD", note: "Electricity", spent_on: new Date().toISOString().slice(0,10) }],
  ]],
  [6, "b0gccw8wkkc888o4ckoo88ok", [
    ["/api/registries", { title: "Sasha & Andre's Wedding", owner_name: "Sasha", event_date: "2026-08-15" }],
  ]],
  [7, "p4s8gg8goc40s0ww8444sg4o", [
    ["/api/events", { name: "Reggae Sunsplash", event_date: "2026-07-04", venue: "Hope Gardens", price: 3500, capacity: 500 }],
  ]],
  [8, "akgokk0ggkk808gcgc4gw4ko", [
    ["/api/plans", { name: "Monthly Coffee Box", cadence: "monthly", price: 4500, currency: "JMD" }],
  ]],
  [9, "p48cc84sk4g400wk0gg8swss", [
    ["/api/items", { category: "Mains", name: "Jerk Chicken", description: "With rice & peas", price: 1800, currency: "JMD" }],
    ["/api/items", { category: "Drinks", name: "Sorrel", price: 400, currency: "JMD" }],
  ]],
  [10, "n4kw4g4k8ccgoow000g0s0o0", [
    ["/api/campaigns", { name: "Limited Hoodie Drop", deposit: 1500, full_price: 5000, target_qty: 50, currency: "JMD" }],
  ]],
  [17, "zc0wcwgkswkwkcsgk4ggscw0", [
    ["/api/tag-rules", { label: "VIP", min_total: 10000 }],
    ["/api/birthdays", { name: "Maria Brown", email: "maria@example.com", birthday: "1990-06-02" }],
  ]],
  // Bookerva verticals — seed a service + booking into a couple.
  [23, "kowggc4ko0g0wc4o000kwswo", [
    ["/api/services", { vertical: "tradesman", name: "Plumbing call-out", duration_min: 60, price: 6000, currency: "JMD" }],
    ["/api/bookings", { vertical: "tradesman", customer: "Mr. Campbell", contact: "8765551234", starts_at: new Date(Date.now()+86400000).toISOString(), resource: "Crew A", detail: "12 Hope Rd — leaking kitchen tap" }],
  ]],
  [24, "kowggc4ko0g0wc4o000kwswo", [
    ["/api/services", { vertical: "salon", name: "Wash & Style", duration_min: 45, price: 3500, currency: "JMD" }],
    ["/api/bookings", { vertical: "salon", customer: "Keisha", contact: "8765559876", starts_at: new Date(Date.now()+172800000).toISOString(), resource: "Tanya" }],
  ]],
];

let ok = 0, fail = 0;
for (const [id, host, items] of SEEDS) {
  try {
    const { jwt } = await sessionFor(id);
    const sid = await bootstrap(H(host), jwt);
    for (const [path, body] of items) {
      const good = await post(H(host), sid, path, body);
      good ? ok++ : fail++;
      process.stdout.write(good ? "." : "x");
    }
  } catch (e) {
    fail += items.length; process.stdout.write("E");
  }
}
console.log(`\nseeded ok=${ok} fail=${fail}`);
await pool.end();
