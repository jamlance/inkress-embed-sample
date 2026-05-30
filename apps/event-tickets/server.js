import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[event-tickets] Missing env: ${k}`); process.exit(1); }
}

const db = openDb("event-tickets", `
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL,
    name TEXT NOT NULL, event_date TEXT, venue TEXT,
    price REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'JMD',
    capacity INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE, buyer_name TEXT,
    checked_in INTEGER NOT NULL DEFAULT 0, issued_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});
const ticketCode = () => "TK-" + crypto.randomBytes(4).toString("hex").toUpperCase();

app.get("/api/events", core.requireSession, (req, res) => {
  const events = db.prepare(`SELECT * FROM events WHERE merchant_id = ? ORDER BY event_date IS NULL, event_date, id DESC`).all(req.session.merchantId);
  const withCounts = events.map((e) => {
    const t = db.prepare(`SELECT COUNT(*) sold, SUM(checked_in) used FROM tickets WHERE event_id = ?`).get(e.id);
    return { ...e, sold: t.sold, checked_in: t.used || 0 };
  });
  res.json({ events: withCounts, stats: {
    events: events.length,
    tickets: withCounts.reduce((s, e) => s + e.sold, 0),
    checked_in: withCounts.reduce((s, e) => s + e.checked_in, 0),
  }});
});

app.post("/api/events", core.requireSession, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "no_name", message: "Event needs a name." });
  const info = db.prepare(`INSERT INTO events (merchant_id, name, event_date, venue, price, currency, capacity) VALUES (?,?,?,?,?,?,?)`)
    .run(req.session.merchantId, name, b.event_date || null, b.venue || null, Number(b.price) || 0, b.currency || "JMD", Number(b.capacity) || 0);
  res.json({ id: info.lastInsertRowid });
});

app.delete("/api/events/:id", core.requireSession, (req, res) => {
  const info = db.prepare(`DELETE FROM events WHERE id = ? AND merchant_id = ?`).run(req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

app.get("/api/events/:id/tickets", core.requireSession, (req, res) => {
  const ev = db.prepare(`SELECT * FROM events WHERE id = ? AND merchant_id = ?`).get(req.params.id, req.session.merchantId);
  if (!ev) return res.status(404).json({ error: "not_found" });
  const tickets = db.prepare(`SELECT * FROM tickets WHERE event_id = ? ORDER BY id DESC`).all(ev.id);
  res.json({ event: ev, tickets });
});

app.post("/api/events/:id/tickets", core.requireSession, (req, res) => {
  const ev = db.prepare(`SELECT * FROM events WHERE id = ? AND merchant_id = ?`).get(req.params.id, req.session.merchantId);
  if (!ev) return res.status(404).json({ error: "not_found" });
  const sold = db.prepare(`SELECT COUNT(*) n FROM tickets WHERE event_id = ?`).get(ev.id).n;
  if (ev.capacity > 0 && sold >= ev.capacity) return res.status(409).json({ error: "sold_out", message: "Event is at capacity." });
  const code = ticketCode();
  db.prepare(`INSERT INTO tickets (event_id, code, buyer_name) VALUES (?,?,?)`).run(ev.id, code, String(req.body?.buyer_name || "").slice(0, 80) || null);
  res.json({ code });
});

// Check-in by code — scanner mode at the door.
app.post("/api/checkin", core.requireSession, (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  const t = db.prepare(`SELECT t.*, e.name AS event_name FROM tickets t JOIN events e ON e.id = t.event_id
    WHERE t.code = ? AND e.merchant_id = ?`).get(code, req.session.merchantId);
  if (!t) return res.json({ ok: false, reason: "not_found" });
  if (t.checked_in) return res.json({ ok: false, reason: "already_used", event: t.event_name, buyer: t.buyer_name });
  db.prepare(`UPDATE tickets SET checked_in = 1 WHERE id = ?`).run(t.id);
  res.json({ ok: true, event: t.event_name, buyer: t.buyer_name });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[event-tickets] listening on ${HOST}:${PORT}`));
