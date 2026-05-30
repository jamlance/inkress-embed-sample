import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[preorders] Missing env: ${k}`); process.exit(1); }
}

const db = openDb("preorders", `
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL,
    name TEXT NOT NULL, description TEXT,
    deposit REAL NOT NULL DEFAULT 0, full_price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'JMD', target_qty INTEGER NOT NULL DEFAULT 0,
    available_on TEXT, status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL, contact TEXT, qty INTEGER NOT NULL DEFAULT 1,
    deposit_paid INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

app.get("/api/campaigns", core.requireSession, (req, res) => {
  const camps = db.prepare(`SELECT * FROM campaigns WHERE merchant_id = ? ORDER BY status, id DESC`).all(req.session.merchantId);
  const withCounts = camps.map((c) => {
    const s = db.prepare(`SELECT COALESCE(SUM(qty),0) reserved, COALESCE(SUM(deposit_paid),0) paid FROM signups WHERE campaign_id = ?`).get(c.id);
    return { ...c, reserved: s.reserved, deposits_collected: s.paid * c.deposit };
  });
  res.json({ campaigns: withCounts, stats: {
    campaigns: camps.length,
    reserved: withCounts.reduce((s, c) => s + c.reserved, 0),
    deposits: withCounts.reduce((s, c) => s + c.deposits_collected, 0),
  }});
});

app.post("/api/campaigns", core.requireSession, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "no_name", message: "Campaign needs a name." });
  const info = db.prepare(`INSERT INTO campaigns (merchant_id, name, description, deposit, full_price, currency, target_qty, available_on) VALUES (?,?,?,?,?,?,?,?)`)
    .run(req.session.merchantId, name, b.description || null, Number(b.deposit) || 0, Number(b.full_price) || 0, b.currency || "JMD", Number(b.target_qty) || 0, b.available_on || null);
  res.json({ id: info.lastInsertRowid });
});

app.patch("/api/campaigns/:id", core.requireSession, (req, res) => {
  const status = ["open", "closed", "fulfilled"].includes(req.body?.status) ? req.body.status : "open";
  const info = db.prepare(`UPDATE campaigns SET status = ? WHERE id = ? AND merchant_id = ?`).run(status, req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

app.delete("/api/campaigns/:id", core.requireSession, (req, res) => {
  const info = db.prepare(`DELETE FROM campaigns WHERE id = ? AND merchant_id = ?`).run(req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

app.get("/api/campaigns/:id/signups", core.requireSession, (req, res) => {
  const camp = db.prepare(`SELECT * FROM campaigns WHERE id = ? AND merchant_id = ?`).get(req.params.id, req.session.merchantId);
  if (!camp) return res.status(404).json({ error: "not_found" });
  const signups = db.prepare(`SELECT * FROM signups WHERE campaign_id = ? ORDER BY id DESC`).all(camp.id);
  res.json({ campaign: camp, signups });
});

app.post("/api/campaigns/:id/signups", core.requireSession, (req, res) => {
  const camp = db.prepare(`SELECT * FROM campaigns WHERE id = ? AND merchant_id = ?`).get(req.params.id, req.session.merchantId);
  if (!camp) return res.status(404).json({ error: "not_found" });
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "no_name", message: "Signup needs a name." });
  db.prepare(`INSERT INTO signups (campaign_id, name, contact, qty, deposit_paid) VALUES (?,?,?,?,?)`)
    .run(camp.id, name, req.body?.contact || null, Number(req.body?.qty) || 1, req.body?.deposit_paid ? 1 : 0);
  res.json({ ok: true });
});

app.patch("/api/signups/:id", core.requireSession, (req, res) => {
  const paid = req.body?.deposit_paid ? 1 : 0;
  const info = db.prepare(`UPDATE signups SET deposit_paid = ? WHERE id = ? AND campaign_id IN
    (SELECT id FROM campaigns WHERE merchant_id = ?)`).run(paid, req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[preorders] listening on ${HOST}:${PORT}`));
