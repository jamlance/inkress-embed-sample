import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) {
    console.error(`[promo-codes] Missing env: ${k}`);
    process.exit(1);
  }
}

const db = openDb("promo-codes", `
  CREATE TABLE IF NOT EXISTS codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
    value REAL NOT NULL,
    currency TEXT,
    min_order REAL NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT 0,
    used_count INTEGER NOT NULL DEFAULT 0,
    starts_at TEXT,
    ends_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS codes_merchant_code
    ON codes (merchant_id, code);
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE,
  frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

app.get("/api/codes", core.requireSession, (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM codes WHERE merchant_id = ? ORDER BY active DESC, created_at DESC`)
    .all(req.session.merchantId);
  const stats = {
    total: rows.length,
    active: rows.filter((r) => r.active).length,
    redemptions: rows.reduce((s, r) => s + r.used_count, 0),
  };
  res.json({ codes: rows, stats });
});

app.post("/api/codes", core.requireSession, (req, res) => {
  const b = req.body || {};
  const code = String(b.code || "").trim().toUpperCase();
  const kind = b.kind === "fixed" ? "fixed" : "percent";
  const value = Number(b.value);
  if (!code || !/^[A-Z0-9_-]{2,32}$/.test(code)) {
    return res.status(400).json({ error: "invalid_code", message: "Code must be 2–32 chars (A–Z, 0–9, -, _)." });
  }
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ error: "invalid_value", message: "Value must be a positive number." });
  }
  if (kind === "percent" && value > 100) {
    return res.status(400).json({ error: "invalid_percent", message: "Percent discount can't exceed 100." });
  }
  try {
    const info = db
      .prepare(`INSERT INTO codes (merchant_id, code, kind, value, currency, min_order, max_uses, starts_at, ends_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        req.session.merchantId,
        code,
        kind,
        value,
        b.currency || null,
        Number(b.min_order) || 0,
        Number(b.max_uses) || 0,
        b.starts_at || null,
        b.ends_at || null,
      );
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "duplicate", message: `Code ${code} already exists.` });
    }
    res.status(500).json({ error: "insert_failed", message: err.message });
  }
});

app.patch("/api/codes/:id", core.requireSession, (req, res) => {
  const active = req.body?.active ? 1 : 0;
  const info = db
    .prepare(`UPDATE codes SET active = ? WHERE id = ? AND merchant_id = ?`)
    .run(active, req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

app.delete("/api/codes/:id", core.requireSession, (req, res) => {
  const info = db
    .prepare(`DELETE FROM codes WHERE id = ? AND merchant_id = ?`)
    .run(req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

// Public redemption check — an external checkout can validate a code.
app.get("/api/validate", (req, res) => {
  const merchantId = Number(req.query.merchant_id);
  const code = String(req.query.code || "").trim().toUpperCase();
  const orderTotal = Number(req.query.total) || 0;
  if (!merchantId || !code) return res.status(400).json({ valid: false, reason: "missing_params" });
  const row = db
    .prepare(`SELECT * FROM codes WHERE merchant_id = ? AND code = ? AND active = 1`)
    .get(merchantId, code);
  if (!row) return res.json({ valid: false, reason: "not_found" });
  const now = new Date().toISOString();
  if (row.starts_at && now < row.starts_at) return res.json({ valid: false, reason: "not_started" });
  if (row.ends_at && now > row.ends_at) return res.json({ valid: false, reason: "expired" });
  if (row.max_uses > 0 && row.used_count >= row.max_uses) return res.json({ valid: false, reason: "max_uses" });
  if (orderTotal < row.min_order) return res.json({ valid: false, reason: "below_min", min_order: row.min_order });
  const discount = row.kind === "percent" ? (orderTotal * row.value) / 100 : row.value;
  res.json({ valid: true, kind: row.kind, value: row.value, discount: Math.round(discount * 100) / 100 });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[promo-codes] listening on ${HOST}:${PORT}`));
