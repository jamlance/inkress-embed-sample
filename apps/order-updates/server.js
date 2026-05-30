import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi, orderStatusName } from "@bookerva-apps/core";
import { openPg } from "@bookerva-apps/core/pgdb";
import { sendEmail, sesConfigured } from "@bookerva-apps/core/ses";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[order-updates] Missing env: ${k}`); process.exit(1); }
}

const db = await openPg("order_updates", `
  CREATE TABLE IF NOT EXISTS settings (
    merchant_id BIGINT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sends (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL, order_ref TEXT, event TEXT, email TEXT,
    message_id TEXT, sent_by_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_ou_sends ON sends (merchant_id, created_at DESC);
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

export const EVENTS = ["paid", "confirmed", "prepared", "shipped", "delivered", "completed", "refunded", "cancelled"];
const DEFAULTS = {
  paid: { enabled: true, subject: "We got your payment — {{shop}}", body: "Thanks {{name}}! Your order {{ref}} for {{total}} is confirmed. We'll keep you posted." },
  shipped: { enabled: true, subject: "Your order is on the way — {{shop}}", body: "Good news {{name}} — order {{ref}} has shipped." },
  delivered: { enabled: false, subject: "Delivered — {{shop}}", body: "Hi {{name}}, order {{ref}} has been delivered. Enjoy!" },
  refunded: { enabled: false, subject: "Your refund is processed — {{shop}}", body: "Hi {{name}}, we've refunded order {{ref}} ({{total}})." },
  cancelled: { enabled: false, subject: "Order cancelled — {{shop}}", body: "Hi {{name}}, order {{ref}} has been cancelled." },
};
const merchantName = (req) => req.session.data?.merchant?.name || "your shop";
async function getTemplates(mid) { const r = await db.one(`SELECT data FROM settings WHERE merchant_id=$1`, [mid]); return { ...DEFAULTS, ...(r?.data?.templates || {}) }; }

const curOf = (o) => o.currency?.code || o.currency_code || "JMD";

app.get("/api/orders", core.requireSession, async (req, res) => {
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, `orders?limit=60&order=id desc`);
    const orders = (r?.result?.entries || []).map((o) => ({
      id: o.id, ref: o.reference_id || String(o.id), status: orderStatusName(o),
      total: Number(o.total || 0), currency: curOf(o),
      customer: o.customer ? { name: [o.customer.first_name, o.customer.last_name].filter(Boolean).join(" ") || o.customer.email, email: o.customer.email || null } : null,
      created_at: o.inserted_at || o.created_at || null,
    }));
    res.json({ orders, ses_configured: sesConfigured() });
  } catch (err) { res.status(502).json({ error: "orders_failed", message: err?.message }); }
});

app.get("/api/templates", core.requireSession, async (req, res) => res.json({ templates: await getTemplates(req.session.merchantId), events: EVENTS, ses_configured: sesConfigured() }));
app.post("/api/templates", core.requireSession, async (req, res) => {
  const t = req.body?.templates || {};
  const clean = {};
  for (const e of EVENTS) if (t[e]) clean[e] = { enabled: !!t[e].enabled, subject: String(t[e].subject || "").slice(0, 160), body: String(t[e].body || "").slice(0, 1000) };
  await db.run(`INSERT INTO settings (merchant_id, data, updated_at) VALUES ($1,$2,now()) ON CONFLICT (merchant_id) DO UPDATE SET data=$2, updated_at=now()`, [req.session.merchantId, JSON.stringify({ templates: clean })]);
  res.json({ templates: { ...DEFAULTS, ...clean } });
});

app.post("/api/orders/:id/send", core.requireSession, async (req, res) => {
  const event = EVENTS.includes(req.body?.event) ? req.body.event : "paid";
  if (!sesConfigured()) return res.status(400).json({ error: "email_off", message: "Email isn't configured." });
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, `orders/${encodeURIComponent(req.params.id)}`);
    const o = r?.result; if (!o) return res.status(404).json({ error: "not_found" });
    const email = o.customer?.email;
    if (!email) return res.status(400).json({ error: "no_email", message: "Order has no customer email." });
    const t = (await getTemplates(req.session.merchantId))[event] || DEFAULTS.paid;
    const shop = merchantName(req);
    const name = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || "there";
    const ref = o.reference_id || String(o.id);
    const total = fmtMoney(Number(o.total || 0), curOf(o));
    const fill = (s) => String(s).replace(/\{\{shop\}\}/g, shop).replace(/\{\{name\}\}/g, name).replace(/\{\{ref\}\}/g, ref).replace(/\{\{total\}\}/g, total);
    const out = await sendEmail({ to: email, subject: fill(t.subject), html: emailHtml(shop, fill(t.body), ref, total) });
    await db.run(`INSERT INTO sends (merchant_id, order_ref, event, email, message_id, sent_by_name) VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.session.merchantId, ref, event, email, out.messageId, req.actor?.name || null]);
    res.json({ ok: true });
  } catch (err) { res.status(502).json({ error: "send_failed", message: err?.message }); }
});

app.get("/api/log", core.requireSession, async (req, res) => res.json({ log: await db.q(`SELECT * FROM sends WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.session.merchantId]) }));

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[order-updates] listening on ${HOST}:${PORT}`));

function fmtMoney(n, c) { try { return new Intl.NumberFormat("en-JM", { style: "currency", currency: c }).format(n); } catch { return `${c} ${n}`; } }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function emailHtml(shop, body, ref, total) {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a;">
    <h2 style="margin:0 0 4px;">${esc(shop)}</h2>
    <p style="color:#555;margin:0 0 16px;">${esc(body)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 0;color:#888;">Order</td><td align="right" style="padding:6px 0;">${esc(ref)}</td></tr>
      <tr><td style="padding:6px 0;color:#888;">Total</td><td align="right" style="padding:6px 0;font-weight:600;">${esc(total)}</td></tr>
    </table>
    <p style="color:#aaa;font-size:12px;margin-top:18px;">${esc(shop)} · via Marketplace</p></div>`;
}
