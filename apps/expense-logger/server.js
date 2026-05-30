import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi, isPaidStatus } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[expense-logger] Missing env: ${k}`); process.exit(1); }
}

const db = openDb("expense-logger", `
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'JMD',
    note TEXT,
    spent_on TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS expenses_merchant ON expenses (merchant_id, spent_on);
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE,
  frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

app.get("/api/summary", core.requireSession, async (req, res) => {
  const since = monthStart();
  const expenseRows = db
    .prepare(`SELECT category, currency, SUM(amount) AS total FROM expenses
              WHERE merchant_id = ? AND spent_on >= ? GROUP BY category, currency`)
    .all(req.session.merchantId, since);
  const expenseTotal = expenseRows.reduce((s, r) => s + r.total, 0);

  // Revenue from Inkress this month (paid orders).
  let revenue = 0;
  let primaryCurrency = "JMD";
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken,
      `orders?limit=500&order=id desc&updated_since=${encodeURIComponent(since + "T00:00:00Z")}`);
    const orders = r?.result?.entries || [];
    for (const o of orders) {
      if (isPaidStatus(o)) {
        revenue += Number(o.total || 0);
        primaryCurrency = (o.currency?.code || o.currency_code || primaryCurrency);
      }
    }
  } catch (err) {
    // Revenue is best-effort; expenses still render.
  }

  res.json({
    month_start: since,
    revenue: Math.round(revenue * 100) / 100,
    expenses: Math.round(expenseTotal * 100) / 100,
    profit: Math.round((revenue - expenseTotal) * 100) / 100,
    currency: primaryCurrency,
    by_category: expenseRows,
  });
});

app.get("/api/expenses", core.requireSession, (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM expenses WHERE merchant_id = ? ORDER BY spent_on DESC, id DESC LIMIT 200`)
    .all(req.session.merchantId);
  res.json({ expenses: rows });
});

app.post("/api/expenses", core.requireSession, (req, res) => {
  const b = req.body || {};
  const amount = Number(b.amount);
  const category = String(b.category || "").trim();
  if (!category) return res.status(400).json({ error: "no_category", message: "Pick a category." });
  if (!Number.isFinite(amount) || amount <= 0)
    return res.status(400).json({ error: "bad_amount", message: "Amount must be positive." });
  const info = db
    .prepare(`INSERT INTO expenses (merchant_id, category, amount, currency, note, spent_on)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      req.session.merchantId, category, amount,
      b.currency || "JMD", b.note || null,
      b.spent_on || new Date().toISOString().slice(0, 10),
    );
  res.json({ id: info.lastInsertRowid });
});

app.delete("/api/expenses/:id", core.requireSession, (req, res) => {
  const info = db
    .prepare(`DELETE FROM expenses WHERE id = ? AND merchant_id = ?`)
    .run(req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[expense-logger] listening on ${HOST}:${PORT}`));
