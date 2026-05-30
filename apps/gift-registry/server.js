import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[gift-registry] Missing env: ${k}`); process.exit(1); }
}

const db = openDb("gift-registry", `
  CREATE TABLE IF NOT EXISTS registries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    owner_name TEXT,
    event_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registry_id INTEGER NOT NULL REFERENCES registries(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price REAL,
    currency TEXT,
    claimed_by TEXT,
    claimed_at TEXT
  );
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "registry";

app.get("/api/registries", core.requireSession, (req, res) => {
  const regs = db.prepare(`SELECT * FROM registries WHERE merchant_id = ? ORDER BY created_at DESC`).all(req.session.merchantId);
  const withCounts = regs.map((r) => {
    const items = db.prepare(`SELECT COUNT(*) n, SUM(claimed_by IS NOT NULL) claimed FROM items WHERE registry_id = ?`).get(r.id);
    return { ...r, item_count: items.n, claimed_count: items.claimed || 0 };
  });
  res.json({
    registries: withCounts,
    stats: {
      registries: regs.length,
      items: withCounts.reduce((s, r) => s + r.item_count, 0),
      claimed: withCounts.reduce((s, r) => s + r.claimed_count, 0),
    },
  });
});

app.post("/api/registries", core.requireSession, (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim();
  if (!title) return res.status(400).json({ error: "no_title", message: "Give the registry a title." });
  let slug = slugify(title);
  let n = 0;
  while (db.prepare(`SELECT 1 FROM registries WHERE slug = ?`).get(slug)) slug = `${slugify(title)}-${++n}`;
  const info = db.prepare(`INSERT INTO registries (merchant_id, slug, title, owner_name, event_date) VALUES (?,?,?,?,?)`)
    .run(req.session.merchantId, slug, title, b.owner_name || null, b.event_date || null);
  res.json({ id: info.lastInsertRowid, slug });
});

app.delete("/api/registries/:id", core.requireSession, (req, res) => {
  const info = db.prepare(`DELETE FROM registries WHERE id = ? AND merchant_id = ?`).run(req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

app.get("/api/registries/:id/items", core.requireSession, (req, res) => {
  const reg = db.prepare(`SELECT * FROM registries WHERE id = ? AND merchant_id = ?`).get(req.params.id, req.session.merchantId);
  if (!reg) return res.status(404).json({ error: "not_found" });
  const items = db.prepare(`SELECT * FROM items WHERE registry_id = ? ORDER BY id`).all(reg.id);
  res.json({ registry: reg, items });
});

app.post("/api/registries/:id/items", core.requireSession, (req, res) => {
  const reg = db.prepare(`SELECT * FROM registries WHERE id = ? AND merchant_id = ?`).get(req.params.id, req.session.merchantId);
  if (!reg) return res.status(404).json({ error: "not_found" });
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "no_name", message: "Item needs a name." });
  const info = db.prepare(`INSERT INTO items (registry_id, name, price, currency) VALUES (?,?,?,?)`)
    .run(reg.id, name, Number(b.price) || null, b.currency || null);
  res.json({ id: info.lastInsertRowid });
});

app.delete("/api/items/:id", core.requireSession, (req, res) => {
  const info = db.prepare(`DELETE FROM items WHERE id = ? AND registry_id IN
    (SELECT id FROM registries WHERE merchant_id = ?)`).run(req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

// Public registry view — gift-givers see + claim items, no auth.
app.get("/api/public/:slug", (req, res) => {
  const reg = db.prepare(`SELECT id, slug, title, owner_name, event_date FROM registries WHERE slug = ?`).get(req.params.slug);
  if (!reg) return res.status(404).json({ error: "not_found" });
  const items = db.prepare(`SELECT id, name, price, currency, claimed_by IS NOT NULL AS claimed FROM items WHERE registry_id = ?`).all(reg.id);
  res.json({ registry: reg, items });
});
app.post("/api/public/:slug/claim/:itemId", (req, res) => {
  const reg = db.prepare(`SELECT id FROM registries WHERE slug = ?`).get(req.params.slug);
  if (!reg) return res.status(404).json({ error: "not_found" });
  const claimer = String(req.body?.name || "A guest").slice(0, 80);
  const info = db.prepare(`UPDATE items SET claimed_by = ?, claimed_at = datetime('now')
    WHERE id = ? AND registry_id = ? AND claimed_by IS NULL`).run(claimer, req.params.itemId, reg.id);
  res.json({ ok: info.changes > 0 });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[gift-registry] listening on ${HOST}:${PORT}`));
