import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi } from "@bookerva-apps/core";
import { openPg } from "@bookerva-apps/core/pgdb";
import { sendEmail, sesConfigured } from "@bookerva-apps/core/ses";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[back-in-stock] Missing env: ${k}`); process.exit(1); }
}

const db = await openPg("back_in_stock", `
  CREATE TABLE IF NOT EXISTS watches (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL,
    product_id TEXT NOT NULL, product_title TEXT NOT NULL, threshold INTEGER NOT NULL DEFAULT 1,
    merchant_name TEXT, merchant_logo TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (merchant_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS waitlist (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL, watch_id BIGINT NOT NULL,
    email TEXT NOT NULL, notified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (watch_id, email)
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL, watch_id BIGINT, product_title TEXT,
    count INTEGER, sent_by_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
  onBootstrap: (entry) => { /* merchant branding cached on entry.data.merchant */ },
});

const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || "";
const stockOf = (p) => (p.unlimited ? Infinity : Number(p.quantity ?? p.stock ?? p.inventory ?? 0));

// ---- Products + watches (auth) ---------------------------------------------
app.get("/api/products", core.requireSession, async (req, res) => {
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, `products?limit=100&order=id desc`);
    const watches = await db.q(`SELECT product_id, id FROM watches WHERE merchant_id=$1`, [req.session.merchantId]);
    const wmap = new Map(watches.map((w) => [String(w.product_id), w.id]));
    const products = (r?.result?.entries || []).map((p) => ({
      id: String(p.id), title: p.title || p.name || `Product ${p.id}`,
      stock: p.unlimited ? null : Number(p.quantity ?? p.stock ?? p.inventory ?? 0), unlimited: !!p.unlimited,
      watch_id: wmap.get(String(p.id)) || null,
    }));
    res.json({ products });
  } catch (err) { res.status(502).json({ error: "products_failed", message: err?.message }); }
});

app.get("/api/watches", core.requireSession, async (req, res) => {
  const watches = await db.q(`SELECT * FROM watches WHERE merchant_id=$1 ORDER BY id DESC`, [req.session.merchantId]);
  const counts = await db.q(`SELECT watch_id, COUNT(*)::int AS waiting, COUNT(notified_at)::int AS notified FROM waitlist WHERE merchant_id=$1 GROUP BY watch_id`, [req.session.merchantId]);
  const cmap = new Map(counts.map((c) => [String(c.watch_id), c]));
  res.json({
    watches: watches.map((w) => ({ id: w.id, product_id: w.product_id, product_title: w.product_title, threshold: w.threshold,
      waiting: cmap.get(String(w.id))?.waiting || 0, notified: cmap.get(String(w.id))?.notified || 0,
      public_url: `${PUBLIC_BASE || `https://${req.get("host")}`}/notify/${w.id}` })),
    ses_configured: sesConfigured(),
  });
});

app.post("/api/watches", core.requireSession, async (req, res) => {
  const b = req.body || {};
  if (!b.product_id) return res.status(400).json({ error: "no_product" });
  const m = req.session.data?.merchant || {};
  const row = await db.one(
    `INSERT INTO watches (merchant_id, product_id, product_title, threshold, merchant_name, merchant_logo)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (merchant_id, product_id) DO UPDATE SET threshold=$4, product_title=$3 RETURNING *`,
    [req.session.merchantId, String(b.product_id), String(b.product_title || "Product"), Math.max(1, Number(b.threshold) || 1), m.name || null, m.logo || m.logo_url || null]);
  res.status(201).json({ watch: { id: row.id } });
});
app.delete("/api/watches/:id", core.requireSession, async (req, res) => {
  await db.run(`DELETE FROM waitlist WHERE watch_id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  await db.run(`DELETE FROM watches WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  res.json({ ok: true });
});

app.get("/api/watches/:id/waitlist", core.requireSession, async (req, res) => {
  const rows = await db.q(`SELECT id, email, notified_at, created_at FROM waitlist WHERE watch_id=$1 AND merchant_id=$2 ORDER BY created_at DESC`, [req.params.id, req.session.merchantId]);
  res.json({ waitlist: rows });
});

// Notify everyone still waiting that the product is back.
app.post("/api/watches/:id/notify", core.requireSession, async (req, res) => {
  if (!sesConfigured()) return res.status(400).json({ error: "email_off", message: "Email isn't configured." });
  const w = await db.one(`SELECT * FROM watches WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  if (!w) return res.status(404).json({ error: "not_found" });
  const waiting = await db.q(`SELECT * FROM waitlist WHERE watch_id=$1 AND notified_at IS NULL`, [w.id]);
  let sent = 0;
  for (const person of waiting) {
    try {
      await sendEmail({ to: person.email, subject: `${w.product_title} is back in stock — ${w.merchant_name || "shop now"}`,
        html: backInStockEmail(w.merchant_name || "the shop", w.product_title) });
      await db.run(`UPDATE waitlist SET notified_at=now() WHERE id=$1`, [person.id]);
      sent++;
    } catch { /* skip */ }
  }
  await db.run(`INSERT INTO alerts (merchant_id, watch_id, product_title, count, sent_by_name) VALUES ($1,$2,$3,$4,$5)`,
    [req.session.merchantId, w.id, w.product_title, sent, req.actor?.name || null]);
  res.json({ sent });
});

app.get("/api/log", core.requireSession, async (req, res) => res.json({ log: await db.q(`SELECT * FROM alerts WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.session.merchantId]) }));

// ---- PUBLIC no-auth "notify me" page ---------------------------------------
app.get("/notify/:watchId", async (req, res) => {
  const w = await db.one(`SELECT * FROM watches WHERE id=$1`, [req.params.watchId]).catch(() => null);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!w) return res.status(404).send(publicShell("Not found", `<p>This product isn't being tracked.</p>`));
  res.send(notifyPage(w));
});
app.post("/api/public/notify/:watchId", express.json(), async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "bad_email" });
  const w = await db.one(`SELECT * FROM watches WHERE id=$1`, [req.params.watchId]).catch(() => null);
  if (!w) return res.status(404).json({ error: "not_found" });
  await db.run(`INSERT INTO waitlist (merchant_id, watch_id, email) VALUES ($1,$2,$3) ON CONFLICT (watch_id, email) DO NOTHING`, [w.merchant_id, w.id, email]);
  res.json({ ok: true });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[back-in-stock] listening on ${HOST}:${PORT}`));

// ---- html helpers ----------------------------------------------------------
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function backInStockEmail(shop, title) {
  return `<div style="font-family:system-ui,sans-serif;max-width:460px;margin:0 auto;text-align:center;color:#1a1a1a;">
    <h2 style="margin:0 0 6px;">${esc(title)} is back! 🎉</h2>
    <p style="color:#555;">Good news — <b>${esc(title)}</b> is available again at <b>${esc(shop)}</b>. Get it before it's gone.</p>
    <p style="color:#aaa;font-size:12px;margin-top:18px;">You asked to be notified · ${esc(shop)} via Marketplace</p></div>`;
}
function publicShell(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f7f9;color:#1f2430;display:grid;place-items:center;min-height:100vh;padding:20px}
  .card{background:#fff;border:1px solid #e9ebef;border-radius:18px;box-shadow:0 12px 40px rgba(20,25,40,.1);max-width:420px;width:100%;padding:28px;text-align:center}
  .logo{width:64px;height:64px;border-radius:18px;object-fit:cover;margin:0 auto 12px;display:block;border:1px solid #eee}
  h1{font-size:1.4rem;margin:0 0 4px}.sub{color:#6b7280;margin:0 0 18px}
  input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #d4d8df;border-radius:10px;font-size:15px;margin-bottom:10px}
  button{width:100%;padding:13px;border:0;border-radius:10px;background:#3b5bdb;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  .accent{height:3px;background:#3b5bdb;border-radius:99px;margin:-28px -28px 20px;border-radius:18px 18px 0 0}
  .ok{color:#2f9e44;font-weight:600}.foot{color:#aab;font-size:12px;margin-top:18px}</style></head>
  <body><div class="card"><div class="accent"></div>${inner}</div></body></html>`;
}
function notifyPage(w) {
  const logo = w.merchant_logo ? `<img class="logo" src="${esc(w.merchant_logo)}" alt="">` : "";
  return publicShell(`${w.product_title} — notify me`, `${logo}
    <h1>${esc(w.product_title)}</h1>
    <p class="sub">Out of stock at <b>${esc(w.merchant_name || "our shop")}</b>. Leave your email and we'll tell you the moment it's back.</p>
    <form id="f"><input id="e" type="email" required placeholder="you@email.com" autocomplete="email"><button type="submit">Notify me</button></form>
    <div id="done" style="display:none" class="ok">✓ You're on the list — we'll email you when it's back.</div>
    <div class="foot">powered by Marketplace</div>
    <script>document.getElementById('f').addEventListener('submit',async(ev)=>{ev.preventDefault();const e=document.getElementById('e').value;const r=await fetch('/api/public/notify/${w.id}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e})});if(r.ok){document.getElementById('f').style.display='none';document.getElementById('done').style.display='block';}else{alert('Please enter a valid email.');}});</script>`);
}
