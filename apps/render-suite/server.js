import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
if (!process.env.INKRESS_API_BASE) { console.error(`[render-suite] Missing env: INKRESS_API_BASE`); process.exit(1); }
if (!process.env.OAUTH_CLIENTS && !process.env.OAUTH_CLIENT_ID) {
  console.error(`[render-suite] Missing env: OAUTH_CLIENTS (or OAUTH_CLIENT_ID)`); process.exit(1);
}

const db = openDb("render-suite", `
  CREATE TABLE IF NOT EXISTS gift_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL,
    code TEXT NOT NULL UNIQUE, amount REAL NOT NULL, balance REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'JMD', recipient TEXT, message TEXT,
    redeemed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL,
    donor TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'JMD',
    note TEXT, received_on TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// OAUTH_CLIENTS is "id1:secret1,id2:secret2,…" — one per path-routed
// listing (invoices/receipts/donations/gift-cards). The core picks the
// right one per session token's aud claim.
// Pairs are ";"-separated ("id:secret;id:secret") so the value can sit
// inside a comma-delimited env list without colliding.
const clients = {};
for (const pair of (process.env.OAUTH_CLIENTS || "").split(/[;,]/)) {
  const [id, secret] = pair.split(":");
  if (id && secret) clients[id.trim()] = secret.trim();
}
if (process.env.OAUTH_CLIENT_ID && process.env.OAUTH_CLIENT_SECRET) {
  clients[process.env.OAUTH_CLIENT_ID] = process.env.OAUTH_CLIENT_SECRET;
}

const app = express();
const core = mountAppCore(app, {
  clients,
  clientId: Object.keys(clients)[0],
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

// --- Orders (invoices + receipts read from Inkress) ---
app.get("/api/orders", core.requireSession, async (req, res) => {
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, `orders?limit=100&order=id desc`);
    const orders = (r?.result?.entries || []).map((o) => ({
      id: o.id, reference_id: o.reference_id || o.id,
      customer: o.customer?.full_name || [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || o.customer?.email || "Customer",
      total: Number(o.total || 0), currency: o.currency?.code || o.currency_code || "JMD",
      status: o.status_name || o.status || "", created: (o.inserted_at || "").slice(0, 10),
      lines: (o.order_lines || o.lines || []).map((l) => ({
        title: l.title || l.name || l.product?.title || "Item", qty: Number(l.quantity || l.qty || 1),
        price: Number(l.price || l.unit_price || 0),
      })),
    }));
    res.json({ orders });
  } catch (err) { res.status(502).json({ error: "orders_failed", message: err?.message }); }
});

// --- Gift cards ---
app.get("/api/gift-cards", core.requireSession, (req, res) => {
  const cards = db.prepare(`SELECT * FROM gift_cards WHERE merchant_id = ? ORDER BY created_at DESC`).all(req.session.merchantId);
  res.json({ cards, stats: { issued: cards.length, active: cards.filter((c) => !c.redeemed && c.balance > 0).length,
    outstanding: cards.reduce((s, c) => s + (c.redeemed ? 0 : c.balance), 0) } });
});
app.post("/api/gift-cards", core.requireSession, (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "bad_amount", message: "Amount must be positive." });
  const code = "GC-" + crypto.randomBytes(5).toString("hex").toUpperCase();
  db.prepare(`INSERT INTO gift_cards (merchant_id, code, amount, balance, currency, recipient, message) VALUES (?,?,?,?,?,?,?)`)
    .run(req.session.merchantId, code, amount, amount, req.body?.currency || "JMD", req.body?.recipient || null, req.body?.message || null);
  res.json({ code });
});
app.delete("/api/gift-cards/:id", core.requireSession, (req, res) => {
  const info = db.prepare(`DELETE FROM gift_cards WHERE id = ? AND merchant_id = ?`).run(req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

// --- Donations ---
app.get("/api/donations", core.requireSession, (req, res) => {
  const rows = db.prepare(`SELECT * FROM donations WHERE merchant_id = ? ORDER BY received_on DESC, id DESC`).all(req.session.merchantId);
  res.json({ donations: rows, stats: { count: rows.length, total: rows.reduce((s, d) => s + d.amount, 0) } });
});
app.post("/api/donations", core.requireSession, (req, res) => {
  const amount = Number(req.body?.amount);
  const donor = String(req.body?.donor || "").trim();
  if (!donor) return res.status(400).json({ error: "no_donor", message: "Enter the donor's name." });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "bad_amount", message: "Amount must be positive." });
  const info = db.prepare(`INSERT INTO donations (merchant_id, donor, amount, currency, note, received_on) VALUES (?,?,?,?,?,?)`)
    .run(req.session.merchantId, donor, amount, req.body?.currency || "JMD", req.body?.note || null, req.body?.received_on || new Date().toISOString().slice(0, 10));
  res.json({ id: info.lastInsertRowid });
});
app.delete("/api/donations/:id", core.requireSession, (req, res) => {
  const info = db.prepare(`DELETE FROM donations WHERE id = ? AND merchant_id = ?`).run(req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[render-suite] listening on ${HOST}:${PORT}`));
