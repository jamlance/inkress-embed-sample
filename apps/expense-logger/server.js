import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi, isPaidStatus } from "@bookerva-apps/core";
import { openPg } from "@bookerva-apps/core/pgdb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[expense-logger] Missing env: ${k}`); process.exit(1); }
}

const db = await openPg("expense_logger", `
  CREATE TABLE IF NOT EXISTS expenses (
    id            BIGSERIAL PRIMARY KEY,
    merchant_id   BIGINT NOT NULL,
    spent_on      DATE NOT NULL,
    amount        NUMERIC NOT NULL,
    currency      TEXT NOT NULL DEFAULT 'JMD',
    category      TEXT NOT NULL DEFAULT 'Other',
    vendor        TEXT,
    note          TEXT,
    created_by_id   BIGINT,
    created_by_name TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_merchant ON expenses (merchant_id, spent_on DESC);
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE,
  frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const RANGES = { "30d": 30, "90d": 90, "365d": 365 };
export const CATEGORIES = ["Supplies", "Rent", "Salaries", "Utilities", "Marketing", "Equipment", "Inventory", "Transport", "Fees", "Other"];

function rangeStart(range) { return new Date(Date.now() - (RANGES[range] || 30) * 86400 * 1000); }
function serialize(r) {
  return { id: r.id, spent_on: r.spent_on, amount: Number(r.amount), currency: r.currency, category: r.category, vendor: r.vendor, note: r.note,
    created_by: r.created_by_name ? { id: r.created_by_id, name: r.created_by_name } : null, created_at: r.created_at };
}

async function inkressRevenue(session, since, currency) {
  const r = await inkressApi(core.cfg, session.accessToken, `orders?limit=500&order=id desc`);
  const paid = (r?.result?.entries || []).filter((o) => isPaidStatus(o) && new Date(o.inserted_at || o.created_at || 0) >= since && (!currency || (o.currency?.code || o.currency_code) === currency));
  return round2(paid.reduce((s, o) => s + Number(o.total || 0), 0));
}

// ---- Overview (revenue vs expenses → profit) -------------------------------
app.get("/api/overview", core.requireSession, async (req, res) => {
  const range = RANGES[req.query.range] ? req.query.range : "30d";
  const since = rangeStart(range);
  const currency = req.session.data?.merchant?.currency_code || "JMD";
  try {
    const sinceStr = since.toISOString().slice(0, 10);
    const rows = await db.q(`SELECT * FROM expenses WHERE merchant_id=$1 AND spent_on >= $2 ORDER BY spent_on DESC, id DESC`, [req.session.merchantId, sinceStr]);
    let revenue = 0; let revenueOk = true;
    try { revenue = await inkressRevenue(req.session, since, currency); } catch { revenueOk = false; }

    const total = round2(rows.reduce((s, e) => s + Number(e.amount), 0));
    const byCat = new Map();
    for (const e of rows) byCat.set(e.category, round2((byCat.get(e.category) || 0) + Number(e.amount)));
    const by_category = [...byCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

    res.json({
      range, currency, revenue, revenue_ok: revenueOk,
      expenses_total: total, profit: round2(revenue - total),
      expense_count: rows.length, by_category,
      recent: rows.slice(0, 6).map(serialize),
    });
  } catch (err) { res.status(502).json({ error: "overview_failed", message: err?.message }); }
});

// ---- Expenses CRUD ---------------------------------------------------------
app.get("/api/expenses", core.requireSession, async (req, res) => {
  const range = RANGES[req.query.range] ? req.query.range : "90d";
  const cat = req.query.category ? String(req.query.category) : null;
  const conds = [`merchant_id=$1`, `spent_on >= $2`];
  const params = [req.session.merchantId, rangeStart(range).toISOString().slice(0, 10)];
  if (cat) { params.push(cat); conds.push(`category=$${params.length}`); }
  const rows = await db.q(`SELECT * FROM expenses WHERE ${conds.join(" AND ")} ORDER BY spent_on DESC, id DESC LIMIT 300`, params);
  res.json({ expenses: rows.map(serialize), categories: CATEGORIES });
});

app.post("/api/expenses", core.requireSession, async (req, res) => {
  const b = req.body || {};
  const amount = round2(b.amount);
  if (!(amount > 0)) return res.status(400).json({ error: "bad_amount", message: "Enter an amount greater than zero." });
  const spent = /^\d{4}-\d{2}-\d{2}$/.test(b.spent_on) ? b.spent_on : new Date().toISOString().slice(0, 10);
  const row = await db.one(
    `INSERT INTO expenses (merchant_id, spent_on, amount, currency, category, vendor, note, created_by_id, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.session.merchantId, spent, amount, (b.currency || req.session.data?.merchant?.currency_code || "JMD"),
     String(b.category || "Other").slice(0, 40), b.vendor || null, b.note || null, req.actor?.id || null, req.actor?.name || null]);
  res.status(201).json({ expense: serialize(row) });
});

app.patch("/api/expenses/:id", core.requireSession, async (req, res) => {
  const b = req.body || {};
  const row = await db.one(`SELECT * FROM expenses WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  if (!row) return res.status(404).json({ error: "not_found" });
  const updated = await db.one(
    `UPDATE expenses SET spent_on=$1, amount=$2, category=$3, vendor=$4, note=$5 WHERE id=$6 RETURNING *`,
    [/^\d{4}-\d{2}-\d{2}$/.test(b.spent_on) ? b.spent_on : row.spent_on, b.amount != null ? round2(b.amount) : row.amount,
     b.category || row.category, b.vendor ?? row.vendor, b.note ?? row.note, row.id]);
  res.json({ expense: serialize(updated) });
});

app.delete("/api/expenses/:id", core.requireSession, async (req, res) => {
  await db.run(`DELETE FROM expenses WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  res.json({ ok: true });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[expense-logger] listening on ${HOST}:${PORT}`));
