import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi, orderStatusName, isPaidStatus } from "@bookerva-apps/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[currency-dashboard] Missing env: ${k}`); process.exit(1); }
}

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE,
  frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const RANGES = { "7d": 7, "30d": 30, "90d": 90 };
const curOf = (o) => o.currency?.code || o.currency_code || "JMD";

// --- Wallet balances (best-effort) ----------------------------------------
app.get("/api/balances", core.requireSession, async (req, res) => {
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, "merchants/account/balances", { method: "POST", body: JSON.stringify({}) });
    const raw = r?.result || r || {};
    const balances = Array.isArray(raw)
      ? raw.map((b) => ({ currency: b.currency_code || b.currency, available: round2(b.available), pending: round2(b.pending) }))
      : (raw.currency || raw.available != null)
        ? [{ currency: raw.currency_code || raw.currency || "JMD", available: round2(raw.available), pending: round2(raw.pending) }]
        : [];
    res.json({ balances, available: true });
  } catch (err) {
    res.json({ balances: [], available: false, reason: err?.message });
  }
});

// --- Per-currency sales summary -------------------------------------------
app.get("/api/summary", core.requireSession, async (req, res) => {
  const days = RANGES[req.query.range] || 30;
  const since = Date.now() - days * 86400 * 1000;
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, `orders?limit=500&order=id desc`);
    const all = (r?.result?.entries || []).filter((o) => new Date(o.inserted_at || o.created_at || 0).getTime() >= since);

    const byCur = new Map();
    const byDay = new Map();
    for (const o of all) {
      const c = curOf(o);
      const m = byCur.get(c) || { currency: c, revenue: 0, paid: 0, orders: 0, refunds: 0 };
      m.orders++;
      if (orderStatusName(o) === "refunded") m.refunds++;
      if (isPaidStatus(o)) {
        m.paid++; m.revenue = round2(m.revenue + Number(o.total || 0));
        const d = new Date(o.inserted_at || o.created_at || 0).toISOString().slice(0, 10);
        const day = byDay.get(d) || {};
        day[c] = round2((day[c] || 0) + Number(o.total || 0));
        byDay.set(d, day);
      }
      byCur.set(c, m);
    }
    const currencies = [...byCur.values()].map((m) => ({ ...m, aov: m.paid ? round2(m.revenue / m.paid) : 0 })).sort((a, b) => b.revenue - a.revenue);
    const trend = [...byDay.entries()].sort().map(([date, vals]) => ({ date, ...vals }));
    res.json({ range: req.query.range || "30d", currencies, trend, currency_codes: currencies.map((c) => c.currency) });
  } catch (err) {
    res.status(502).json({ error: "summary_failed", message: err?.message });
  }
});

// --- Orders list (cross-currency) -----------------------------------------
app.get("/api/orders", core.requireSession, async (req, res) => {
  const cur = req.query.currency ? String(req.query.currency) : null;
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, `orders?limit=100&order=id desc`);
    let orders = (r?.result?.entries || []).map((o) => ({
      id: o.id, ref: o.reference_id || String(o.id),
      total: round2(o.total), currency: curOf(o), status: orderStatusName(o),
      customer: o.customer ? ([o.customer.first_name, o.customer.last_name].filter(Boolean).join(" ") || o.customer.email) : null,
      created_at: o.inserted_at || o.created_at || null,
    }));
    if (cur) orders = orders.filter((o) => o.currency === cur);
    res.json({ orders });
  } catch (err) {
    res.status(502).json({ error: "orders_failed", message: err?.message });
  }
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[currency-dashboard] listening on ${HOST}:${PORT}`));
