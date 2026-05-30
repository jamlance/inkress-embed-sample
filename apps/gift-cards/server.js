import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, createInkressOrder, getInkressOrder, isPaidStatus } from "@bookerva-apps/core";
import { openPg } from "@bookerva-apps/core/pgdb";
import { openMerchantTokens } from "@bookerva-apps/core/merchant-tokens";
import { sendEmail, sesConfigured } from "@bookerva-apps/core/ses";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[gift-cards] Missing env: ${k}`); process.exit(1); }
}

const db = await openPg("gift_cards", `
  CREATE TABLE IF NOT EXISTS designs (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL,
    name TEXT NOT NULL, denominations JSONB NOT NULL DEFAULT '[]', allow_custom BOOLEAN NOT NULL DEFAULT true,
    min_amount NUMERIC NOT NULL DEFAULT 500, max_amount NUMERIC NOT NULL DEFAULT 50000,
    currency TEXT NOT NULL DEFAULT 'JMD', active BOOLEAN NOT NULL DEFAULT true,
    merchant_name TEXT, merchant_logo TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS cards (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL, design_id BIGINT,
    code TEXT NOT NULL, amount NUMERIC NOT NULL, balance NUMERIC NOT NULL, currency TEXT NOT NULL,
    recipient_name TEXT, recipient_email TEXT, buyer_email TEXT, message TEXT,
    ref TEXT, inkress_order_id TEXT, payment_url TEXT, state TEXT NOT NULL DEFAULT 'awaiting',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (merchant_id, code)
  );
  CREATE TABLE IF NOT EXISTS redemptions (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL, card_id BIGINT, code TEXT, amount NUMERIC,
    note TEXT, created_by_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_gc_cards ON cards (merchant_id, state, created_at DESC);
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
  onBootstrap: (entry) => { tokens.save(entry.merchantId, entry.refreshToken).catch(() => {}); },
});
const tokens = await openMerchantTokens("gift_cards", core.cfg);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const PUBLIC_BASE = (req) => process.env.PUBLIC_BASE_URL || `https://${req.get("host")}`;
function genCode() { const part = () => crypto.randomBytes(2).toString("hex").toUpperCase(); return `GC-${part()}-${part()}`; }
const serializeDesign = (d, req) => ({ id: d.id, name: d.name, denominations: d.denominations || [], allow_custom: d.allow_custom, min_amount: Number(d.min_amount), max_amount: Number(d.max_amount), currency: d.currency, active: d.active, public_url: `${PUBLIC_BASE(req)}/gift/${d.id}` });
const serializeCard = (c) => ({ id: c.id, code: c.code, amount: Number(c.amount), balance: Number(c.balance), currency: c.currency, recipient_name: c.recipient_name, recipient_email: c.recipient_email, state: c.state, created_at: c.created_at });

// ---- Designs (auth) --------------------------------------------------------
app.get("/api/designs", core.requireSession, async (req, res) => {
  const rows = await db.q(`SELECT * FROM designs WHERE merchant_id=$1 ORDER BY id DESC`, [req.session.merchantId]);
  res.json({ designs: rows.map((d) => serializeDesign(d, req)), connected: await tokens.hasToken(req.session.merchantId), ses_configured: sesConfigured() });
});
app.post("/api/designs", core.requireSession, async (req, res) => {
  const b = req.body || {}; const m = req.session.data?.merchant || {};
  const denoms = Array.isArray(b.denominations) ? b.denominations.map(round2).filter((n) => n > 0) : [];
  const row = await db.one(
    `INSERT INTO designs (merchant_id, name, denominations, allow_custom, min_amount, max_amount, currency, merchant_name, merchant_logo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.session.merchantId, String(b.name || "Gift Card").slice(0, 80), JSON.stringify(denoms), b.allow_custom !== false,
     round2(b.min_amount) || 500, round2(b.max_amount) || 50000, m.currency_code || "JMD", m.name || null, m.logo || m.logo_url || null]);
  res.status(201).json({ design: serializeDesign(row, req) });
});
app.patch("/api/designs/:id", core.requireSession, async (req, res) => {
  const b = req.body || {};
  const d = await db.one(`SELECT * FROM designs WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  if (!d) return res.status(404).json({ error: "not_found" });
  const denoms = Array.isArray(b.denominations) ? b.denominations.map(round2).filter((n) => n > 0) : d.denominations;
  const u = await db.one(`UPDATE designs SET name=$1, denominations=$2, allow_custom=$3, min_amount=$4, max_amount=$5, active=$6 WHERE id=$7 RETURNING *`,
    [b.name ?? d.name, JSON.stringify(denoms), b.allow_custom != null ? !!b.allow_custom : d.allow_custom, b.min_amount != null ? round2(b.min_amount) : d.min_amount, b.max_amount != null ? round2(b.max_amount) : d.max_amount, b.active != null ? !!b.active : d.active, d.id]);
  res.json({ design: serializeDesign(u, req) });
});
app.delete("/api/designs/:id", core.requireSession, async (req, res) => { await db.run(`DELETE FROM designs WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]); res.json({ ok: true }); });

// ---- Cards + redemption (auth) ---------------------------------------------
app.get("/api/cards", core.requireSession, async (req, res) => {
  if (req.query.refresh === "1") {
    const awaiting = await db.q(`SELECT * FROM cards WHERE merchant_id=$1 AND state='awaiting' AND inkress_order_id IS NOT NULL LIMIT 25`, [req.session.merchantId]);
    for (const c of awaiting) {
      try { const ink = await getInkressOrder(core.cfg, req.session.accessToken, c.inkress_order_id);
        if (ink && isPaidStatus(ink)) { await db.run(`UPDATE cards SET state='active' WHERE id=$1`, [c.id]); await emailCard(c).catch(() => {}); } } catch { /* */ }
    }
  }
  const rows = await db.q(`SELECT * FROM cards WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.session.merchantId]);
  const active = rows.filter((c) => c.state === "active" || c.state === "redeemed");
  res.json({ cards: rows.map(serializeCard), stats: {
    sold: active.length, outstanding: round2(active.reduce((s, c) => s + Number(c.balance), 0)),
    redeemed_value: round2(rows.reduce((s, c) => s + (Number(c.amount) - Number(c.balance)), 0)), awaiting: rows.filter((c) => c.state === "awaiting").length,
  } });
});
app.post("/api/cards/lookup", core.requireSession, async (req, res) => {
  const c = await db.one(`SELECT * FROM cards WHERE merchant_id=$1 AND code=$2`, [req.session.merchantId, String(req.body?.code || "").trim().toUpperCase()]);
  if (!c) return res.json({ found: false });
  res.json({ found: true, card: serializeCard(c) });
});
app.post("/api/cards/:id/redeem", core.requireSession, async (req, res) => {
  const c = await db.one(`SELECT * FROM cards WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  if (!c) return res.status(404).json({ error: "not_found" });
  if (c.state === "awaiting") return res.status(400).json({ error: "not_active", message: "This card hasn't been paid for yet." });
  const amount = round2(req.body?.amount);
  if (!(amount > 0) || amount > Number(c.balance)) return res.status(400).json({ error: "bad_amount", message: `Enter an amount up to ${c.balance}.` });
  const newBal = round2(Number(c.balance) - amount);
  const u = await db.one(`UPDATE cards SET balance=$1, state=$2 WHERE id=$3 RETURNING *`, [newBal, newBal <= 0 ? "redeemed" : "active", c.id]);
  await db.run(`INSERT INTO redemptions (merchant_id, card_id, code, amount, note, created_by_name) VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.session.merchantId, c.id, c.code, amount, req.body?.note || null, req.actor?.name || null]);
  res.json({ card: serializeCard(u) });
});
app.get("/api/redemptions", core.requireSession, async (req, res) => res.json({ redemptions: await db.q(`SELECT id, code, amount, note, created_by_name, created_at FROM redemptions WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.session.merchantId]) }));

// ---- PUBLIC buy page -------------------------------------------------------
app.get("/gift/:id", async (req, res) => {
  const d = await db.one(`SELECT * FROM designs WHERE id=$1`, [req.params.id]).catch(() => null);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!d || !d.active) return res.status(404).send(publicShell("Unavailable", `<div class="pad"><h1>Gift cards unavailable</h1></div>`));
  res.send(buyPage(d));
});
app.post("/api/public/gift/:id", express.json(), async (req, res) => {
  const d = await db.one(`SELECT * FROM designs WHERE id=$1`, [req.params.id]).catch(() => null);
  if (!d || !d.active) return res.status(404).json({ error: "closed" });
  const amount = round2(req.body?.amount);
  if (!(amount >= Number(d.min_amount) && amount <= Number(d.max_amount))) return res.status(400).json({ error: "bad_amount", message: `Amount must be between ${d.min_amount} and ${d.max_amount}.` });
  const recipient_email = String(req.body?.recipient_email || "").trim().toLowerCase();
  const buyer_email = String(req.body?.buyer_email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient_email)) return res.status(400).json({ error: "bad_email", message: "Enter the recipient's email." });
  let accessToken;
  try { accessToken = await tokens.accessTokenFor(d.merchant_id); } catch { return res.status(503).json({ error: "not_connected", message: "This shop hasn't finished setup." }); }

  const ref = `giftcard-${d.merchant_id}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
  let created;
  try {
    created = await createInkressOrder(core.cfg, accessToken, {
      referenceId: ref, total: amount, currencyCode: d.currency, kind: "online", title: `Gift card — ${d.name}`,
      customer: { email: buyer_email || recipient_email, first_name: "Gift", last_name: "Buyer" },
      metaData: { source: "gift-cards", design_id: d.id, recipient: recipient_email },
    });
  } catch (err) { return res.status(502).json({ error: "order_failed", message: err?.message }); }

  await db.run(`INSERT INTO cards (merchant_id, design_id, code, amount, balance, currency, recipient_name, recipient_email, buyer_email, message, ref, inkress_order_id, payment_url)
    VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [d.merchant_id, d.id, genCode(), amount, d.currency, req.body?.recipient_name || null, recipient_email, buyer_email || null, String(req.body?.message || "").slice(0, 300), ref, created.id != null ? String(created.id) : null, created.payment_url || null]);
  res.json({ payment_url: created.payment_url });
});

async function emailCard(card) {
  if (!sesConfigured() || !card.recipient_email) return;
  const d = await db.one(`SELECT * FROM designs WHERE id=$1`, [card.design_id]).catch(() => null);
  const shop = d?.merchant_name || "a shop";
  await sendEmail({ to: card.recipient_email, subject: `🎁 You've got a gift card from ${shop}`, html: cardEmail(shop, card) });
}

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[gift-cards] listening on ${HOST}:${PORT}`));

// ---- html ------------------------------------------------------------------
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function money(n, c) { try { return new Intl.NumberFormat("en-JM", { style: "currency", currency: c }).format(n); } catch { return `${c} ${n}`; } }
function cardEmail(shop, card) {
  return `<div style="font-family:system-ui,sans-serif;max-width:460px;margin:0 auto;text-align:center;color:#1a1a1a;">
    <div style="font-size:40px;">🎁</div><h2 style="margin:4px 0 6px;">A gift from ${esc(shop)}</h2>
    ${card.message ? `<p style="color:#555;">"${esc(card.message)}"</p>` : ""}
    <div style="border:2px dashed #3b5bdb;border-radius:14px;padding:18px;margin:14px 0;">
      <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.06em;">Gift card · ${esc(money(Number(card.amount), card.currency))}</div>
      <div style="font-size:26px;font-weight:800;letter-spacing:.04em;margin-top:4px;">${esc(card.code)}</div></div>
    <p style="color:#aaa;font-size:12px;">Show this code in store at ${esc(shop)} · via Marketplace</p></div>`;
}
function publicShell(title, inner, accent = "#3b5bdb") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f7f9;color:#1f2430;display:grid;place-items:center;min-height:100vh;padding:20px}
  .card{background:#fff;border:1px solid #e9ebef;border-radius:18px;box-shadow:0 14px 44px rgba(20,25,40,.12);max-width:440px;width:100%;overflow:hidden}
  .accent{height:4px;background:${accent}} .pad{padding:26px}
  .logo{width:60px;height:60px;border-radius:16px;object-fit:cover;margin:0 auto 12px;display:block;border:1px solid #eee}
  h1{font-size:1.5rem;margin:0 0 6px;text-align:center} .blurb{color:#6b7280;text-align:center;margin:0 0 16px}
  .denoms{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px}
  .den{padding:10px 16px;border:1px solid #d4d8df;border-radius:10px;cursor:pointer;font-weight:600}.den.sel{border-color:${accent};background:#eef1fd;color:${accent}}
  input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #d4d8df;border-radius:10px;font-size:15px;margin-bottom:10px}
  button{width:100%;padding:14px;border:0;border-radius:10px;background:${accent};color:#fff;font-size:15px;font-weight:700;cursor:pointer}
  .foot{text-align:center;color:#aab;font-size:12px;padding:14px}</style></head>
  <body><div class="card"><div class="accent"></div>${inner}<div class="foot">powered by Marketplace</div></div></body></html>`;
}
function buyPage(d) {
  const logo = d.merchant_logo ? `<img class="logo" src="${esc(d.merchant_logo)}" alt="">` : "";
  const denoms = (d.denominations || []).map((a) => `<div class="den" data-a="${a}">${esc(money(Number(a), d.currency))}</div>`).join("");
  return publicShell(`${d.name}`, `<div class="pad">${logo}
    <h1>${esc(d.name)}</h1><p class="blurb">A gift card for ${esc(d.merchant_name || "our shop")}</p>
    <div class="denoms">${denoms}</div>
    ${d.allow_custom ? `<input id="amt" type="number" min="${d.min_amount}" max="${d.max_amount}" placeholder="Custom amount (${esc(money(Number(d.min_amount), d.currency))}–${esc(money(Number(d.max_amount), d.currency))})">` : `<input id="amt" type="hidden">`}
    <input id="rn" placeholder="Recipient name (optional)">
    <input id="re" type="email" required placeholder="Recipient email">
    <input id="msg" placeholder="Short message (optional)">
    <input id="be" type="email" placeholder="Your email (optional, for the receipt)">
    <button id="buy">Buy gift card</button>
    <div id="msgbox" style="display:none;color:#6b7280;text-align:center;margin-top:10px"></div>
    <script>let amt=0;document.querySelectorAll('.den').forEach(d=>d.addEventListener('click',()=>{document.querySelectorAll('.den').forEach(x=>x.classList.remove('sel'));d.classList.add('sel');amt=Number(d.dataset.a);const ai=document.getElementById('amt');if(ai.type!=='hidden')ai.value=amt;}));
    document.getElementById('buy').addEventListener('click',async()=>{const ai=document.getElementById('amt');const a=ai.type==='hidden'?amt:(Number(ai.value)||amt);if(!a){showMsg('Pick or enter an amount.');return;}const re=document.getElementById('re').value;if(!re){showMsg('Enter the recipient email.');return;}const b=document.getElementById('buy');b.disabled=true;b.textContent='Creating your link…';const r=await fetch('/api/public/gift/${d.id}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:a,recipient_name:document.getElementById('rn').value,recipient_email:re,message:document.getElementById('msg').value,buyer_email:document.getElementById('be').value})});const j=await r.json();if(j.payment_url){window.location.href=j.payment_url;}else{b.disabled=false;b.textContent='Buy gift card';showMsg(j.message||'Something went wrong.');}});
    function showMsg(t){const m=document.getElementById('msgbox');m.style.display='block';m.textContent=t;}</script></div>`);
}
