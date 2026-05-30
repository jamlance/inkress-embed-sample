import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { mountAppCore, inkressApi, orderStatusName, isPaidStatus } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
if (!process.env.INKRESS_API_BASE) { console.error("[automation] Missing INKRESS_API_BASE"); process.exit(1); }

const clients = {};
for (const pair of (process.env.OAUTH_CLIENTS || "").split(/[;,]/)) {
  const [id, secret] = pair.split(":");
  if (id && secret) clients[id.trim()] = secret.trim();
}

const SES_FROM = process.env.SES_FROM || "Bookerva <noreply@bookerva.com>";
const ses = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  ? new SESClient({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
    })
  : null;

async function sendEmail(to, subject, html) {
  if (!ses) throw new Error("email_not_configured");
  await ses.send(new SendEmailCommand({
    Source: SES_FROM, Destination: { ToAddresses: [to] },
    Message: { Subject: { Data: subject }, Body: { Html: { Data: html } } },
  }));
}

const db = openDb("automation-suite", `
  CREATE TABLE IF NOT EXISTS birthdays (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL,
    name TEXT NOT NULL, email TEXT, birthday TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tag_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL,
    label TEXT NOT NULL, min_total REAL DEFAULT 0, status_is TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS restock_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL,
    product_id INTEGER, product_title TEXT, threshold INTEGER DEFAULT 5, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS configs (
    merchant_id INTEGER NOT NULL, app TEXT NOT NULL, json TEXT NOT NULL,
    PRIMARY KEY (merchant_id, app)
  );
`);

const app = express();
const core = mountAppCore(app, {
  clients, clientId: Object.keys(clients)[0],
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

const merchantEmail = (req) => req.session.data?.merchant?.email || null;
const merchantName = (req) => req.session.data?.merchant?.name || "your shop";

// -------- Digest --------
app.get("/api/digest/preview", core.requireSession, async (req, res) => {
  const since = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, `orders?limit=200&order=id desc&updated_since=${since}T00:00:00Z`);
    const orders = r?.result?.entries || [];
    const paid = orders.filter((o) => isPaidStatus(o));
    const revenue = paid.reduce((s, o) => s + Number(o.total || 0), 0);
    const cur = paid[0]?.currency?.code || paid[0]?.currency_code || "JMD";
    const top = paid.slice().sort((a,b)=>Number(b.total||0)-Number(a.total||0))[0];
    res.json({ since, paid_count: paid.length, revenue: Math.round(revenue*100)/100, currency: cur,
      biggest: top ? { ref: top.reference_id || top.id, total: Number(top.total||0) } : null });
  } catch (err) { res.status(502).json({ error: "digest_failed", message: err?.message }); }
});
app.post("/api/digest/send", core.requireSession, async (req, res) => {
  const to = req.body?.to || merchantEmail(req);
  if (!to) return res.status(400).json({ error: "no_recipient", message: "No email on file — enter one." });
  const d = req.body?.summary || {};
  const html = `<div style="font-family:Inter,sans-serif;max-width:480px;">
    <h2>Yesterday at ${esc(merchantName(req))}</h2>
    <p>Revenue: <strong>${money(d.revenue||0, d.currency||"JMD")}</strong> from <strong>${d.paid_count||0}</strong> paid orders.</p>
    ${d.biggest ? `<p>Biggest order: #${esc(String(d.biggest.ref))} at ${money(d.biggest.total, d.currency||"JMD")}.</p>` : ""}
    <p style="color:#888;font-size:12px;">Daily Digest · by Bookerva</p></div>`;
  try { await sendEmail(to, `Daily digest — ${merchantName(req)}`, html); res.json({ ok: true, to }); }
  catch (err) { res.status(502).json({ error: "send_failed", message: err.message }); }
});

// -------- Birthdays --------
app.get("/api/birthdays", core.requireSession, (req, res) => {
  const rows = db.prepare(`SELECT * FROM birthdays WHERE merchant_id = ? ORDER BY strftime('%m-%d', birthday)`).all(req.session.merchantId);
  const mmdd = new Date().toISOString().slice(5, 10);
  const soon = rows.filter((r) => { const b = (r.birthday||"").slice(5,10); const days = dayDiff(mmdd, b); return days >= 0 && days <= 7; });
  res.json({ birthdays: rows, upcoming: soon, stats: { total: rows.length, upcoming: soon.length } });
});
app.post("/api/birthdays", core.requireSession, (req, res) => {
  const name = String(req.body?.name||"").trim();
  if (!name || !req.body?.birthday) return res.status(400).json({ error: "missing", message: "Name and birthday required." });
  db.prepare(`INSERT INTO birthdays (merchant_id, name, email, birthday) VALUES (?,?,?,?)`)
    .run(req.session.merchantId, name, req.body.email || null, req.body.birthday);
  res.json({ ok: true });
});
app.delete("/api/birthdays/:id", core.requireSession, (req, res) => {
  db.prepare(`DELETE FROM birthdays WHERE id=? AND merchant_id=?`).run(req.params.id, req.session.merchantId); res.json({ ok: true });
});
app.post("/api/birthdays/:id/send", core.requireSession, async (req, res) => {
  const b = db.prepare(`SELECT * FROM birthdays WHERE id=? AND merchant_id=?`).get(req.params.id, req.session.merchantId);
  if (!b || !b.email) return res.status(400).json({ error: "no_email", message: "No email for this contact." });
  const code = req.body?.code || "BDAY10";
  const html = `<div style="font-family:Inter,sans-serif;max-width:480px;text-align:center;">
    <h2>Happy Birthday, ${esc(b.name)}! 🎂</h2>
    <p>${esc(merchantName(req))} wants to celebrate with you.</p>
    <p style="font-size:20px;">Use code <strong>${esc(code)}</strong> for a treat.</p>
    <p style="color:#888;font-size:12px;">with love from ${esc(merchantName(req))} · via Bookerva</p></div>`;
  try { await sendEmail(b.email, `Happy Birthday from ${merchantName(req)}!`, html); res.json({ ok: true }); }
  catch (err) { res.status(502).json({ error: "send_failed", message: err.message }); }
});

// -------- Tagger --------
app.get("/api/tag-rules", core.requireSession, (req, res) => {
  res.json({ rules: db.prepare(`SELECT * FROM tag_rules WHERE merchant_id=? ORDER BY id`).all(req.session.merchantId) });
});
app.post("/api/tag-rules", core.requireSession, (req, res) => {
  const label = String(req.body?.label||"").trim();
  if (!label) return res.status(400).json({ error: "no_label", message: "Tag needs a label." });
  db.prepare(`INSERT INTO tag_rules (merchant_id, label, min_total, status_is) VALUES (?,?,?,?)`)
    .run(req.session.merchantId, label, Number(req.body?.min_total)||0, req.body?.status_is || null);
  res.json({ ok: true });
});
app.delete("/api/tag-rules/:id", core.requireSession, (req, res) => {
  db.prepare(`DELETE FROM tag_rules WHERE id=? AND merchant_id=?`).run(req.params.id, req.session.merchantId); res.json({ ok: true });
});
app.get("/api/tagger/apply", core.requireSession, async (req, res) => {
  const rules = db.prepare(`SELECT * FROM tag_rules WHERE merchant_id=?`).all(req.session.merchantId);
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, `orders?limit=50&order=id desc`);
    const orders = (r?.result?.entries||[]).map((o) => {
      const total = Number(o.total||0); const status = orderStatusName(o);
      const tags = rules.filter((rl) => total >= rl.min_total && (!rl.status_is || status === rl.status_is.toLowerCase())).map((rl) => rl.label);
      return { ref: o.reference_id||o.id, total, currency: o.currency?.code||o.currency_code||"JMD", status, tags };
    });
    res.json({ orders });
  } catch (err) { res.status(502).json({ error: "apply_failed", message: err?.message }); }
});

// -------- Restock --------
app.get("/api/products", core.requireSession, async (req, res) => {
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, `products?limit=100&order=id desc`);
    const products = (r?.result?.entries||[]).map((p) => ({ id: p.id, title: p.title||p.name||`Product ${p.id}`,
      stock: Number(p.quantity ?? p.stock ?? p.inventory ?? 0) }));
    res.json({ products });
  } catch (err) { res.status(502).json({ error: "products_failed", message: err?.message }); }
});
app.get("/api/restock-rules", core.requireSession, (req, res) => {
  res.json({ rules: db.prepare(`SELECT * FROM restock_rules WHERE merchant_id=? ORDER BY id`).all(req.session.merchantId) });
});
app.post("/api/restock-rules", core.requireSession, (req, res) => {
  db.prepare(`INSERT INTO restock_rules (merchant_id, product_id, product_title, threshold) VALUES (?,?,?,?)`)
    .run(req.session.merchantId, req.body?.product_id||null, req.body?.product_title||"Product", Number(req.body?.threshold)||5);
  res.json({ ok: true });
});
app.delete("/api/restock-rules/:id", core.requireSession, (req, res) => {
  db.prepare(`DELETE FROM restock_rules WHERE id=? AND merchant_id=?`).run(req.params.id, req.session.merchantId); res.json({ ok: true });
});

// -------- WA updates config (email delivery for now) --------
app.get("/api/config/:appName", core.requireSession, (req, res) => {
  const row = db.prepare(`SELECT json FROM configs WHERE merchant_id=? AND app=?`).get(req.session.merchantId, req.params.appName);
  res.json({ config: row ? JSON.parse(row.json) : {} });
});
app.put("/api/config/:appName", core.requireSession, (req, res) => {
  db.prepare(`INSERT INTO configs (merchant_id, app, json) VALUES (?,?,?)
    ON CONFLICT(merchant_id, app) DO UPDATE SET json=excluded.json`)
    .run(req.session.merchantId, req.params.appName, JSON.stringify(req.body?.config || {}));
  res.json({ ok: true });
});

function dayDiff(a, b) { const [am,ad]=a.split("-").map(Number); const [bm,bd]=b.split("-").map(Number);
  const ay=new Date(2000,am-1,ad), by=new Date(2000,bm-1,bd); let d=Math.round((by-ay)/86400000); if(d<0)d+=365; return d; }
function money(n,c){ try{return new Intl.NumberFormat("en",{style:"currency",currency:c}).format(n||0);}catch{return `${(n||0).toFixed(2)} ${c}`;} }
function esc(s){ return String(s??"").replace(/[&<>"]/g,(c)=>c==="&"?"&amp;":c==="<"?"&lt;":c===">"?"&gt;":"&quot;"); }

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[automation-suite] listening on ${HOST}:${PORT}`));
