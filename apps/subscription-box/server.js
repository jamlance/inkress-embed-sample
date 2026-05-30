import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[subscription-box] Missing env: ${k}`); process.exit(1); }
}

const db = openDb("subscription-box", `
  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL,
    name TEXT NOT NULL, cadence TEXT NOT NULL DEFAULT 'monthly',
    price REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'JMD',
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    name TEXT NOT NULL, contact TEXT, status TEXT NOT NULL DEFAULT 'active',
    next_renewal TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});
const nextRenewal = (cadence) => {
  const d = new Date();
  if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else if (cadence === "quarterly") d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};

app.get("/api/plans", core.requireSession, (req, res) => {
  const plans = db.prepare(`SELECT * FROM plans WHERE merchant_id = ? ORDER BY active DESC, id DESC`).all(req.session.merchantId);
  const withCounts = plans.map((p) => {
    const c = db.prepare(`SELECT COUNT(*) n FROM subscribers WHERE plan_id = ? AND status='active'`).get(p.id);
    return { ...p, subscribers: c.n };
  });
  const mrr = withCounts.reduce((s, p) => {
    const monthly = p.cadence === "weekly" ? p.price * 4.33 : p.cadence === "quarterly" ? p.price / 3 : p.price;
    return s + monthly * p.subscribers;
  }, 0);
  res.json({ plans: withCounts, stats: {
    plans: plans.length,
    subscribers: withCounts.reduce((s, p) => s + p.subscribers, 0),
    mrr: Math.round(mrr * 100) / 100,
  }});
});

app.post("/api/plans", core.requireSession, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "no_name", message: "Plan needs a name." });
  const cadence = ["weekly", "monthly", "quarterly"].includes(b.cadence) ? b.cadence : "monthly";
  const info = db.prepare(`INSERT INTO plans (merchant_id, name, cadence, price, currency) VALUES (?,?,?,?,?)`)
    .run(req.session.merchantId, name, cadence, Number(b.price) || 0, b.currency || "JMD");
  res.json({ id: info.lastInsertRowid });
});

app.delete("/api/plans/:id", core.requireSession, (req, res) => {
  const info = db.prepare(`DELETE FROM plans WHERE id = ? AND merchant_id = ?`).run(req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

app.get("/api/plans/:id/subscribers", core.requireSession, (req, res) => {
  const plan = db.prepare(`SELECT * FROM plans WHERE id = ? AND merchant_id = ?`).get(req.params.id, req.session.merchantId);
  if (!plan) return res.status(404).json({ error: "not_found" });
  const subs = db.prepare(`SELECT * FROM subscribers WHERE plan_id = ? ORDER BY status, next_renewal`).all(plan.id);
  res.json({ plan, subscribers: subs });
});

app.post("/api/plans/:id/subscribers", core.requireSession, (req, res) => {
  const plan = db.prepare(`SELECT * FROM plans WHERE id = ? AND merchant_id = ?`).get(req.params.id, req.session.merchantId);
  if (!plan) return res.status(404).json({ error: "not_found" });
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "no_name", message: "Subscriber needs a name." });
  db.prepare(`INSERT INTO subscribers (plan_id, name, contact, next_renewal) VALUES (?,?,?,?)`)
    .run(plan.id, name, req.body?.contact || null, nextRenewal(plan.cadence));
  res.json({ ok: true });
});

app.patch("/api/subscribers/:id", core.requireSession, (req, res) => {
  const status = ["active", "paused", "cancelled"].includes(req.body?.status) ? req.body.status : "active";
  const info = db.prepare(`UPDATE subscribers SET status = ? WHERE id = ? AND plan_id IN
    (SELECT id FROM plans WHERE merchant_id = ?)`).run(status, req.params.id, req.session.merchantId);
  res.json({ ok: info.changes > 0 });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[subscription-box] listening on ${HOST}:${PORT}`));
