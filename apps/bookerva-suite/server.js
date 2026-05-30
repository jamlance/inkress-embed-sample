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

const db = openDb("bookerva-suite", `
  CREATE TABLE IF NOT EXISTS merchants_cache (
    merchant_id INTEGER PRIMARY KEY, username TEXT, name TEXT, logo TEXT, currency TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL, vertical TEXT NOT NULL,
    name TEXT NOT NULL, duration_min INTEGER NOT NULL DEFAULT 30, price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'JMD', resource TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL, vertical TEXT NOT NULL,
    service_id INTEGER, service_name TEXT, customer TEXT NOT NULL, contact TEXT,
    starts_at TEXT NOT NULL, ends_at TEXT, resource TEXT, detail TEXT,
    status TEXT NOT NULL DEFAULT 'booked', source TEXT NOT NULL DEFAULT 'staff',
    created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    merchant_id INTEGER NOT NULL, vertical TEXT NOT NULL,
    open_hour INTEGER DEFAULT 9, close_hour INTEGER DEFAULT 17, slot_min INTEGER DEFAULT 30,
    days TEXT DEFAULT '1,2,3,4,5,6', lead_days INTEGER DEFAULT 30,
    PRIMARY KEY (merchant_id, vertical)
  );
`);

const app = express();
const core = mountAppCore(app, {
  clients, clientId: Object.keys(clients)[0],
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
  onBootstrap: (entry) => {
    const m = entry.data?.merchant;
    if (m?.id) {
      db.prepare(`INSERT INTO merchants_cache (merchant_id, username, name, logo, currency)
        VALUES (?,?,?,?,?) ON CONFLICT(merchant_id) DO UPDATE SET
        username=excluded.username, name=excluded.name, logo=excluded.logo, currency=excluded.currency, updated_at=datetime('now')`)
        .run(m.id, m.username || null, m.name || null, m.logo || null, m.currency_code || m.currency?.code || "JMD");
    }
  },
});

const V = (req) => String(req.query.vertical || req.body?.vertical || "basic");
const getSettings = (mid, v) => db.prepare(`SELECT * FROM settings WHERE merchant_id=? AND vertical=?`).get(mid, v)
  || { open_hour: 9, close_hour: 17, slot_min: 30, days: "1,2,3,4,5,6", lead_days: 30 };

function slotsForDate(mid, v, serviceId, dateStr) {
  const s = getSettings(mid, v);
  const allowDays = String(s.days).split(",").map(Number);
  const date = new Date(dateStr + "T00:00:00");
  if (!allowDays.includes(date.getDay())) return [];
  const svc = serviceId ? db.prepare(`SELECT duration_min FROM services WHERE id=? AND merchant_id=?`).get(serviceId, mid) : null;
  const dur = svc?.duration_min || s.slot_min;
  const taken = db.prepare(`SELECT starts_at, ends_at FROM bookings WHERE merchant_id=? AND vertical=? AND status='booked' AND substr(starts_at,1,10)=?`).all(mid, v, dateStr)
    .map((b) => [new Date(b.starts_at).getTime(), b.ends_at ? new Date(b.ends_at).getTime() : new Date(b.starts_at).getTime() + dur * 60000]);
  const out = [];
  const now = Date.now();
  for (let min = s.open_hour * 60; min + dur <= s.close_hour * 60; min += s.slot_min) {
    const start = new Date(date); start.setHours(0, min, 0, 0);
    const st = start.getTime(), en = st + dur * 60000;
    if (st < now) continue;
    const clash = taken.some(([ts, te]) => st < te && en > ts);
    if (!clash) out.push(start.toISOString());
  }
  return out;
}

/* ---------------- merchant API (session) ---------------- */
app.get("/api/overview", core.requireSession, (req, res) => {
  const v = V(req), mid = req.session.merchantId;
  const todayStr = new Date().toISOString().slice(0, 10);
  const today = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE merchant_id=? AND vertical=? AND status='booked' AND substr(starts_at,1,10)=?`).get(mid, v, todayStr).n;
  const upcoming = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE merchant_id=? AND vertical=? AND status='booked' AND starts_at>=?`).get(mid, v, new Date().toISOString()).n;
  const services = db.prepare(`SELECT COUNT(*) n FROM services WHERE merchant_id=? AND vertical=?`).get(mid, v).n;
  const next = db.prepare(`SELECT * FROM bookings WHERE merchant_id=? AND vertical=? AND status='booked' AND starts_at>=? ORDER BY starts_at LIMIT 8`).all(mid, v, new Date().toISOString());
  res.json({ stats: { today, upcoming, services }, next, share_url: `${baseUrl(req)}/book/${mid}?v=${v}` });
});

app.get("/api/bookings", core.requireSession, (req, res) => {
  const rows = db.prepare(`SELECT * FROM bookings WHERE merchant_id=? AND vertical=? ORDER BY starts_at DESC LIMIT 300`).all(req.session.merchantId, V(req));
  res.json({ bookings: rows });
});
app.post("/api/bookings", core.requireSession, (req, res) => {
  const b = req.body || {};
  if (!String(b.customer || "").trim() || !b.starts_at) return res.status(400).json({ error: "missing", message: "Customer and time required." });
  const svc = b.service_id ? db.prepare(`SELECT name, duration_min FROM services WHERE id=? AND merchant_id=?`).get(b.service_id, req.session.merchantId) : null;
  const ends = svc ? new Date(new Date(b.starts_at).getTime() + svc.duration_min * 60000).toISOString() : null;
  db.prepare(`INSERT INTO bookings (merchant_id, vertical, service_id, service_name, customer, contact, starts_at, ends_at, resource, detail, source, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.session.merchantId, V(req), b.service_id || null, svc?.name || b.service_name || null, b.customer, b.contact || null, b.starts_at, ends, b.resource || null, b.detail || null, "staff", req.actor?.name || "Staff");
  res.json({ ok: true });
});
app.patch("/api/bookings/:id", core.requireSession, (req, res) => {
  const status = ["booked", "completed", "cancelled", "no_show"].includes(req.body?.status) ? req.body.status : "booked";
  db.prepare(`UPDATE bookings SET status=? WHERE id=? AND merchant_id=?`).run(status, req.params.id, req.session.merchantId); res.json({ ok: true });
});
app.delete("/api/bookings/:id", core.requireSession, (req, res) => {
  db.prepare(`DELETE FROM bookings WHERE id=? AND merchant_id=?`).run(req.params.id, req.session.merchantId); res.json({ ok: true });
});

app.get("/api/services", core.requireSession, (req, res) => {
  res.json({ services: db.prepare(`SELECT * FROM services WHERE merchant_id=? AND vertical=? ORDER BY id`).all(req.session.merchantId, V(req)) });
});
app.post("/api/services", core.requireSession, (req, res) => {
  if (!String(req.body?.name || "").trim()) return res.status(400).json({ error: "no_name", message: "Name required." });
  db.prepare(`INSERT INTO services (merchant_id, vertical, name, duration_min, price, currency, resource) VALUES (?,?,?,?,?,?,?)`)
    .run(req.session.merchantId, V(req), req.body.name, Number(req.body.duration_min) || 30, Number(req.body.price) || 0, req.body.currency || "JMD", req.body.resource || null);
  res.json({ ok: true });
});
app.delete("/api/services/:id", core.requireSession, (req, res) => {
  db.prepare(`DELETE FROM services WHERE id=? AND merchant_id=?`).run(req.params.id, req.session.merchantId); res.json({ ok: true });
});

app.get("/api/settings", core.requireSession, (req, res) => res.json({ settings: getSettings(req.session.merchantId, V(req)) }));
app.put("/api/settings", core.requireSession, (req, res) => {
  const b = req.body || {};
  db.prepare(`INSERT INTO settings (merchant_id, vertical, open_hour, close_hour, slot_min, days, lead_days)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(merchant_id, vertical) DO UPDATE SET
    open_hour=excluded.open_hour, close_hour=excluded.close_hour, slot_min=excluded.slot_min, days=excluded.days, lead_days=excluded.lead_days`)
    .run(req.session.merchantId, V(req), Number(b.open_hour) || 9, Number(b.close_hour) || 17, Number(b.slot_min) || 30, b.days || "1,2,3,4,5,6", Number(b.lead_days) || 30);
  res.json({ ok: true });
});

/* ---------------- PUBLIC booking API (no auth) ---------------- */
app.get("/api/public/:mid/info", (req, res) => {
  const mid = Number(req.params.mid), v = String(req.query.v || "basic");
  const m = db.prepare(`SELECT merchant_id, name, logo, currency FROM merchants_cache WHERE merchant_id=?`).get(mid);
  if (!m) return res.status(404).json({ error: "not_found" });
  const services = db.prepare(`SELECT id, name, duration_min, price, currency, resource FROM services WHERE merchant_id=? AND vertical=? ORDER BY id`).all(mid, v);
  res.json({ merchant: m, vertical: v, services, settings: getSettings(mid, v) });
});
app.get("/api/public/:mid/slots", (req, res) => {
  const mid = Number(req.params.mid), v = String(req.query.v || "basic");
  res.json({ slots: slotsForDate(mid, v, Number(req.query.service_id) || null, String(req.query.date || new Date().toISOString().slice(0, 10))) });
});
app.post("/api/public/:mid/book", (req, res) => {
  const mid = Number(req.params.mid), b = req.body || {}, v = String(b.vertical || "basic");
  if (!String(b.customer || "").trim() || !b.starts_at) return res.status(400).json({ error: "missing", message: "Please enter your name and pick a time." });
  // Re-check the slot is still free.
  const free = slotsForDate(mid, v, Number(b.service_id) || null, String(b.starts_at).slice(0, 10));
  if (!free.includes(b.starts_at)) return res.status(409).json({ error: "taken", message: "Sorry, that time was just taken. Pick another." });
  const svc = b.service_id ? db.prepare(`SELECT name, duration_min FROM services WHERE id=? AND merchant_id=?`).get(b.service_id, mid) : null;
  const ends = svc ? new Date(new Date(b.starts_at).getTime() + svc.duration_min * 60000).toISOString() : null;
  db.prepare(`INSERT INTO bookings (merchant_id, vertical, service_id, service_name, customer, contact, starts_at, ends_at, detail, source, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(mid, v, b.service_id || null, svc?.name || null, b.customer, b.contact || null, b.starts_at, ends, b.detail || null, "online", b.customer);
  res.json({ ok: true, service: svc?.name || null });
});

function baseUrl(req) {
  return `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}`;
}

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[bookerva-suite] listening on ${HOST}:${PORT}`));
