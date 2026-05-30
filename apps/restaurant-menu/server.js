import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[restaurant-menu] Missing env: ${k}`); process.exit(1); }
}

const db = openDb("restaurant-menu", `
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'Mains', name TEXT NOT NULL, description TEXT,
    price REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'JMD',
    available INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

app.get("/api/menu", core.requireSession, (req, res) => {
  const items = db.prepare(`SELECT * FROM items WHERE merchant_id = ? ORDER BY category, sort, id`).all(req.session.merchantId);
  const categories = [...new Set(items.map((i) => i.category))];
  res.json({ items, categories, stats: {
    items: items.length,
    available: items.filter((i) => i.available).length,
    categories: categories.length,
  }});
});

app.post("/api/items", core.requireSession, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "no_name", message: "Item needs a name." });
  const info = db.prepare(`INSERT INTO items (merchant_id, category, name, description, price, currency) VALUES (?,?,?,?,?,?)`)
    .run(req.session.merchantId, String(b.category || "Mains").trim() || "Mains", name, b.description || null, Number(b.price) || 0, b.currency || "JMD");
  res.json({ id: info.lastInsertRowid });
});

app.patch("/api/items/:id", core.requireSession, (req, res) => {
  const avail = req.body?.available ? 1 : 0;
  const info = db.prepare(`UPDATE items SET available = ? WHERE id = ? AND merchant_id = ?`).run(avail, req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

app.delete("/api/items/:id", core.requireSession, (req, res) => {
  const info = db.prepare(`DELETE FROM items WHERE id = ? AND merchant_id = ?`).run(req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

// Public menu — diners scan a QR pointing at /m/<merchant_id>.
app.get("/api/public/:merchantId", (req, res) => {
  const items = db.prepare(`SELECT category, name, description, price, currency FROM items
    WHERE merchant_id = ? AND available = 1 ORDER BY category, sort, id`).all(Number(req.params.merchantId));
  res.json({ items });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[restaurant-menu] listening on ${HOST}:${PORT}`));
