import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi, orderStatusName, isPaidStatus } from "@bookerva-apps/core";
import { openPg } from "@bookerva-apps/core/pgdb";
import { sendEmail, sesConfigured } from "@bookerva-apps/core/ses";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[sales-digest] Missing env: ${k}`); process.exit(1); }
}

const db = await openPg("sales_digest", `
  CREATE TABLE IF NOT EXISTS recipients (
    id          BIGSERIAL PRIMARY KEY,
    merchant_id BIGINT NOT NULL,
    email       TEXT NOT NULL,
    name        TEXT,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    source      TEXT NOT NULL DEFAULT 'manual',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (merchant_id, email)
  );
  CREATE TABLE IF NOT EXISTS settings (
    merchant_id BIGINT PRIMARY KEY,
    data        JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS send_log (
    id           BIGSERIAL PRIMARY KEY,
    merchant_id  BIGINT NOT NULL,
    range_label  TEXT,
    currency     TEXT,
    revenue      NUMERIC,
    orders       INTEGER,
    recipients   JSONB,
    message_ids  JSONB,
    sent_by_id   BIGINT,
    sent_by_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_sendlog_merchant ON send_log (merchant_id, created_at DESC);
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE,
  frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

const RANGES = { today: 0, yesterday: 1, "7d": 7, "30d": 30 };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function rangeBounds(range) {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  if (range === "today") { start.setHours(0, 0, 0, 0); }
  else if (range === "yesterday") { start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0); end.setHours(0, 0, 0, 0); }
  else { const days = RANGES[range] ?? 7; start.setDate(start.getDate() - days); }
  return { start, end };
}

async function computeDigest(session, range, currencyFilter) {
  const r = await inkressApi(core.cfg, session.accessToken, `orders?limit=200&order=id desc`);
  const all = (r?.result?.entries || []);
  const { start, end } = rangeBounds(range);
  const inRange = all.filter((o) => {
    const t = new Date(o.inserted_at || o.created_at || 0).getTime();
    return t >= start.getTime() && t < end.getTime() && (!currencyFilter || (o.currency?.code || o.currency_code) === currencyFilter);
  });
  const paid = inRange.filter((o) => isPaidStatus(o));
  const currency = currencyFilter || paid[0]?.currency?.code || inRange[0]?.currency?.code || paid[0]?.currency_code || "JMD";
  const revenue = round2(paid.reduce((s, o) => s + Number(o.total || 0), 0));
  const refunds = inRange.filter((o) => orderStatusName(o) === "refunded").length;
  const biggest = paid.slice().sort((a, b) => Number(b.total || 0) - Number(a.total || 0))[0];

  // distinct customers + new (first order in window heuristic: appears in range but not before)
  const beforeEmails = new Set(all.filter((o) => new Date(o.inserted_at || 0).getTime() < start.getTime()).map((o) => o.customer?.email).filter(Boolean));
  const rangeEmails = new Set(paid.map((o) => o.customer?.email).filter(Boolean));
  const newCustomers = [...rangeEmails].filter((e) => !beforeEmails.has(e)).length;

  // by-day sparkline
  const byDayMap = new Map();
  for (const o of paid) {
    const d = new Date(o.inserted_at || o.created_at || 0).toISOString().slice(0, 10);
    byDayMap.set(d, round2((byDayMap.get(d) || 0) + Number(o.total || 0)));
  }
  const by_day = [...byDayMap.entries()].sort().map(([date, total]) => ({ date, total }));

  // top products (best-effort: order list may carry order_items)
  const prodMap = new Map();
  for (const o of paid) {
    for (const li of (o.order_items || o.line_items || o.items || [])) {
      const title = li.title || li.product?.title || li.name;
      if (!title) continue;
      const qty = Number(li.quantity ?? li.qty ?? 1);
      prodMap.set(title, (prodMap.get(title) || 0) + qty);
    }
  }
  const top_products = [...prodMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([title, qty]) => ({ title, qty }));

  return {
    range, currency,
    revenue, orders: inRange.length, paid: paid.length,
    aov: paid.length ? round2(revenue / paid.length) : 0,
    refunds, new_customers: newCustomers,
    biggest: biggest ? { ref: biggest.reference_id || biggest.id, total: round2(Number(biggest.total || 0)), customer: biggest.customer ? [biggest.customer.first_name, biggest.customer.last_name].filter(Boolean).join(" ") || biggest.customer.email : null } : null,
    by_day, top_products,
  };
}

const merchantEmail = (req) => req.session.data?.merchant?.email || null;
const merchantName = (req) => req.session.data?.merchant?.name || "your shop";

// ---- Digest preview --------------------------------------------------------
app.get("/api/digest", core.requireSession, async (req, res) => {
  const range = RANGES[req.query.range] !== undefined ? req.query.range : "7d";
  const currency = req.query.currency ? String(req.query.currency).toUpperCase() : null;
  try { res.json({ digest: await computeDigest(req.session, range, currency), ses_configured: sesConfigured() }); }
  catch (err) { res.status(502).json({ error: "digest_failed", message: err?.message }); }
});

// ---- Recipients ------------------------------------------------------------
async function listRecipients(req) {
  let rows = await db.q(`SELECT * FROM recipients WHERE merchant_id=$1 ORDER BY id`, [req.session.merchantId]);
  if (!rows.length && merchantEmail(req)) {
    await db.run(`INSERT INTO recipients (merchant_id, email, name, source) VALUES ($1,$2,$3,'merchant') ON CONFLICT DO NOTHING`,
      [req.session.merchantId, merchantEmail(req), merchantName(req)]);
    rows = await db.q(`SELECT * FROM recipients WHERE merchant_id=$1 ORDER BY id`, [req.session.merchantId]);
  }
  return rows;
}
app.get("/api/recipients", core.requireSession, async (req, res) => {
  res.json({ recipients: await listRecipients(req), ses_configured: sesConfigured() });
});
app.post("/api/recipients", core.requireSession, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "bad_email", message: "Enter a valid email." });
  await db.run(`INSERT INTO recipients (merchant_id, email, name, source) VALUES ($1,$2,$3,'manual') ON CONFLICT (merchant_id, email) DO NOTHING`,
    [req.session.merchantId, email, req.body?.name || null]);
  res.status(201).json({ recipients: await listRecipients(req) });
});
app.patch("/api/recipients/:id", core.requireSession, async (req, res) => {
  await db.run(`UPDATE recipients SET enabled=$1 WHERE id=$2 AND merchant_id=$3`, [!!req.body?.enabled, req.params.id, req.session.merchantId]);
  res.json({ ok: true });
});
app.delete("/api/recipients/:id", core.requireSession, async (req, res) => {
  await db.run(`DELETE FROM recipients WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  res.json({ ok: true });
});

// ---- Settings (schedule) ---------------------------------------------------
app.get("/api/settings", core.requireSession, async (req, res) => {
  const row = await db.one(`SELECT data FROM settings WHERE merchant_id=$1`, [req.session.merchantId]);
  res.json({ settings: row?.data || { frequency: "daily", time: "08:00", range: "yesterday" } });
});
app.post("/api/settings", core.requireSession, async (req, res) => {
  const b = req.body || {};
  const data = {
    frequency: ["daily", "weekly", "off"].includes(b.frequency) ? b.frequency : "daily",
    time: String(b.time || "08:00").slice(0, 5),
    range: RANGES[b.range] !== undefined ? b.range : "yesterday",
    currency: b.currency ? String(b.currency).toUpperCase().slice(0, 3) : null,
  };
  await db.run(`INSERT INTO settings (merchant_id, data, updated_at) VALUES ($1,$2,now()) ON CONFLICT (merchant_id) DO UPDATE SET data=$2, updated_at=now()`,
    [req.session.merchantId, JSON.stringify(data)]);
  res.json({ settings: data });
});

// ---- Send now --------------------------------------------------------------
app.post("/api/digest/send", core.requireSession, async (req, res) => {
  const range = RANGES[req.body?.range] !== undefined ? req.body.range : "yesterday";
  const currency = req.body?.currency ? String(req.body.currency).toUpperCase() : null;
  const recips = (await listRecipients(req)).filter((r) => r.enabled);
  if (!recips.length) return res.status(400).json({ error: "no_recipients", message: "Add or enable at least one recipient." });
  if (!sesConfigured()) return res.status(400).json({ error: "email_off", message: "Email sending isn't configured." });

  let digest;
  try { digest = await computeDigest(req.session, range, currency); }
  catch (err) { return res.status(502).json({ error: "digest_failed", message: err?.message }); }

  const html = digestHtml(merchantName(req), digest, range);
  const subject = `${labelFor(range)} sales — ${merchantName(req)}`;
  const messageIds = [];
  const failures = [];
  for (const r of recips) {
    try { const out = await sendEmail({ to: r.email, subject, html }); messageIds.push({ email: r.email, id: out.messageId }); }
    catch (err) { failures.push({ email: r.email, error: err?.message }); }
  }
  await db.run(
    `INSERT INTO send_log (merchant_id, range_label, currency, revenue, orders, recipients, message_ids, sent_by_id, sent_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [req.session.merchantId, labelFor(range), digest.currency, digest.revenue, digest.paid,
     JSON.stringify(recips.map((r) => r.email)), JSON.stringify(messageIds), req.actor?.id || null, req.actor?.name || null]);
  res.json({ sent: messageIds.length, failed: failures.length, message_ids: messageIds, failures, digest });
});

app.get("/api/log", core.requireSession, async (req, res) => {
  res.json({ log: await db.q(`SELECT * FROM send_log WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.session.merchantId]) });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[sales-digest] listening on ${HOST}:${PORT}`));

// ---- email + labels --------------------------------------------------------
function labelFor(range) { return ({ today: "Today's", yesterday: "Yesterday's", "7d": "7-day", "30d": "30-day" }[range]) || "Recent"; }
function fmt(n, c) { try { return new Intl.NumberFormat("en-JM", { style: "currency", currency: c }).format(n || 0); } catch { return `${c} ${(n || 0).toFixed(2)}`; } }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x])); }
function digestHtml(merchant, d, range) {
  const rows = (d.top_products || []).map((p) => `<tr><td style="padding:4px 0;color:#444;">${esc(p.title)}</td><td align="right" style="padding:4px 0;color:#444;">${p.qty} sold</td></tr>`).join("");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
    <h2 style="margin:0 0 2px;">${esc(merchant)}</h2>
    <p style="margin:0 0 18px;color:#777;">${labelFor(range)} sales digest</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      <tr>
        <td style="padding:14px;background:#f4f6fb;border-radius:10px;width:50%;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.04em;">Revenue</div>
          <div style="font-size:26px;font-weight:700;">${fmt(d.revenue, d.currency)}</div>
        </td>
        <td style="width:10px;"></td>
        <td style="padding:14px;background:#f4f6fb;border-radius:10px;width:50%;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.04em;">Paid orders</div>
          <div style="font-size:26px;font-weight:700;">${d.paid}</div>
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:8px;">
      <tr><td style="padding:6px 0;color:#666;">Average order</td><td align="right" style="padding:6px 0;">${fmt(d.aov, d.currency)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">New customers</td><td align="right" style="padding:6px 0;">${d.new_customers}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Refunds</td><td align="right" style="padding:6px 0;">${d.refunds}</td></tr>
      ${d.biggest ? `<tr><td style="padding:6px 0;color:#666;">Biggest order</td><td align="right" style="padding:6px 0;">${fmt(d.biggest.total, d.currency)}${d.biggest.customer ? ` · ${esc(d.biggest.customer)}` : ""}</td></tr>` : ""}
    </table>
    ${rows ? `<div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin:14px 0 4px;">Top products</div><table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>` : ""}
    <p style="color:#aaa;font-size:12px;margin-top:22px;">Sales Digest · by Marketplace</p>
  </div>`;
}
