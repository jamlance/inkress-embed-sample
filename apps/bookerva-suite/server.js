import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
if (!process.env.INKRESS_API_BASE) { console.error("[bookerva-suite] Missing INKRESS_API_BASE"); process.exit(1); }

const clients = {};
for (const pair of (process.env.OAUTH_CLIENTS || "").split(/[;,]/)) {
  const [id, secret] = pair.split(":");
  if (id && secret) clients[id.trim()] = secret.trim();
}

// Shared scheduling model across all 9 verticals. `vertical` scopes
// each merchant's data so one deploy cleanly serves all of them.
const db = openDb("bookerva-suite", `
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL, vertical TEXT NOT NULL,
    name TEXT NOT NULL, duration_min INTEGER NOT NULL DEFAULT 30,
    price REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'JMD',
    resource TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL, vertical TEXT NOT NULL,
    service_id INTEGER, service_name TEXT, customer TEXT NOT NULL, contact TEXT,
    starts_at TEXT NOT NULL, resource TEXT, detail TEXT, status TEXT NOT NULL DEFAULT 'booked',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

const app = express();
const core = mountAppCore(app, {
  clients, clientId: Object.keys(clients)[0],
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

const V = (req) => String(req.query.vertical || req.body?.vertical || "basic");

app.get("/api/services", core.requireSession, (req, res) => {
  res.json({ services: db.prepare(`SELECT * FROM services WHERE merchant_id=? AND vertical=? ORDER BY id`).all(req.session.merchantId, V(req)) });
});
app.post("/api/services", core.requireSession, (req, res) => {
  const name = String(req.body?.name||"").trim();
  if (!name) return res.status(400).json({ error: "no_name", message: "Service needs a name." });
  db.prepare(`INSERT INTO services (merchant_id, vertical, name, duration_min, price, currency, resource) VALUES (?,?,?,?,?,?,?)`)
    .run(req.session.merchantId, V(req), name, Number(req.body?.duration_min)||30, Number(req.body?.price)||0, req.body?.currency||"JMD", req.body?.resource||null);
  res.json({ ok: true });
});
app.delete("/api/services/:id", core.requireSession, (req, res) => {
  db.prepare(`DELETE FROM services WHERE id=? AND merchant_id=?`).run(req.params.id, req.session.merchantId); res.json({ ok: true });
});

app.get("/api/bookings", core.requireSession, (req, res) => {
  const rows = db.prepare(`SELECT * FROM bookings WHERE merchant_id=? AND vertical=? ORDER BY starts_at DESC LIMIT 200`).all(req.session.merchantId, V(req));
  const upcoming = rows.filter((b) => b.starts_at >= new Date().toISOString() && b.status === "booked");
  res.json({ bookings: rows, stats: {
    upcoming: upcoming.length, total: rows.length,
    services: db.prepare(`SELECT COUNT(*) n FROM services WHERE merchant_id=? AND vertical=?`).get(req.session.merchantId, V(req)).n,
  }});
});
app.post("/api/bookings", core.requireSession, (req, res) => {
  const b = req.body || {};
  const customer = String(b.customer||"").trim();
  if (!customer || !b.starts_at) return res.status(400).json({ error: "missing", message: "Customer and time required." });
  const svc = b.service_id ? db.prepare(`SELECT name FROM services WHERE id=? AND merchant_id=?`).get(b.service_id, req.session.merchantId) : null;
  db.prepare(`INSERT INTO bookings (merchant_id, vertical, service_id, service_name, customer, contact, starts_at, resource, detail)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(req.session.merchantId, V(req), b.service_id||null, svc?.name || b.service_name || null, customer, b.contact||null, b.starts_at, b.resource||null, b.detail||null);
  res.json({ ok: true });
});
app.patch("/api/bookings/:id", core.requireSession, (req, res) => {
  const status = ["booked","completed","cancelled","no_show"].includes(req.body?.status) ? req.body.status : "booked";
  db.prepare(`UPDATE bookings SET status=? WHERE id=? AND merchant_id=?`).run(status, req.params.id, req.session.merchantId); res.json({ ok: true });
});
app.delete("/api/bookings/:id", core.requireSession, (req, res) => {
  db.prepare(`DELETE FROM bookings WHERE id=? AND merchant_id=?`).run(req.params.id, req.session.merchantId); res.json({ ok: true });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[bookerva-suite] listening on ${HOST}:${PORT}`));
