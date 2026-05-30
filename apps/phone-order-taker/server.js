import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[phone-order-taker] Missing env: ${k}`); process.exit(1); }
}

// Local draft store — phone orders captured before they're pushed
// to Inkress / fulfilled. Keeps a fast operator log even when the
// merchant doesn't want to auto-create live orders.
const db = openDb("phone-order-taker", `
  CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL,
    customer TEXT NOT NULL, contact TEXT, items_json TEXT NOT NULL,
    total REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'JMD',
    note TEXT, status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

// Live product catalogue from Inkress — the operator picks from these.
app.get("/api/products", core.requireSession, async (req, res) => {
  const q = String(req.query.q || "").trim();
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken,
      `products?limit=50&order=id desc${q ? `&q=${encodeURIComponent(q)}` : ""}`);
    const entries = r?.result?.entries || [];
    const products = entries.map((p) => ({
      id: p.id, title: p.title || p.name || `Product ${p.id}`,
      price: Number(p.price ?? p.unit_price ?? 0),
      currency: p.currency?.code || p.currency_code || "JMD",
    }));
    res.json({ products });
  } catch (err) {
    res.status(502).json({ error: "products_failed", message: err?.message });
  }
});

app.get("/api/drafts", core.requireSession, (req, res) => {
  const rows = db.prepare(`SELECT * FROM drafts WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 100`).all(req.session.merchantId);
  const drafts = rows.map((d) => ({ ...d, items: JSON.parse(d.items_json) }));
  res.json({ drafts, stats: {
    open: rows.filter((d) => d.status === "open").length,
    total_value: rows.filter((d) => d.status === "open").reduce((s, d) => s + d.total, 0),
    count: rows.length,
  }});
});

app.post("/api/drafts", core.requireSession, (req, res) => {
  const b = req.body || {};
  const customer = String(b.customer || "").trim();
  const items = Array.isArray(b.items) ? b.items : [];
  if (!customer) return res.status(400).json({ error: "no_customer", message: "Enter a customer name." });
  if (!items.length) return res.status(400).json({ error: "empty_cart", message: "Add at least one item." });
  const total = items.reduce((s, i) => s + Number(i.price) * Number(i.qty || 1), 0);
  const info = db.prepare(`INSERT INTO drafts (merchant_id, customer, contact, items_json, total, currency, note)
    VALUES (?,?,?,?,?,?,?)`)
    .run(req.session.merchantId, customer, b.contact || null, JSON.stringify(items), Math.round(total * 100) / 100, b.currency || "JMD", b.note || null);
  res.json({ id: info.lastInsertRowid, total });
});

app.patch("/api/drafts/:id", core.requireSession, (req, res) => {
  const status = ["open", "fulfilled", "cancelled"].includes(req.body?.status) ? req.body.status : "open";
  const info = db.prepare(`UPDATE drafts SET status = ? WHERE id = ? AND merchant_id = ?`).run(status, req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

app.delete("/api/drafts/:id", core.requireSession, (req, res) => {
  const info = db.prepare(`DELETE FROM drafts WHERE id = ? AND merchant_id = ?`).run(req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[phone-order-taker] listening on ${HOST}:${PORT}`));
