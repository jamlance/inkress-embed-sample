import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";
import { openPg } from "@bookerva-apps/core/pgdb";
import { sendEmail, sesConfigured } from "@bookerva-apps/core/ses";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[birthday-promotions] Missing env: ${k}`); process.exit(1); }
}

const db = await openPg("birthday_promotions", `
  CREATE TABLE IF NOT EXISTS contacts (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL,
    name TEXT NOT NULL, email TEXT, birthday DATE NOT NULL,
    last_sent_year INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (merchant_id, email)
  );
  CREATE TABLE IF NOT EXISTS settings (
    merchant_id BIGINT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sends (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL, contact_id BIGINT, email TEXT, code TEXT,
    message_id TEXT, sent_by_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_bp_contacts ON contacts (merchant_id, birthday);
  CREATE INDEX IF NOT EXISTS idx_bp_sends ON sends (merchant_id, created_at DESC);
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

const merchantName = (req) => req.session.data?.merchant?.name || "your shop";
const DEFAULTS = { subject: "Happy Birthday from {{shop}}! 🎂", body: "We're celebrating you, {{name}}! Enjoy a treat on us.", code: "BDAY10", days_before: 0 };

function daysUntilBirthday(bday) {
  const now = new Date(); const t = new Date(bday);
  const next = new Date(now.getFullYear(), t.getMonth(), t.getDate());
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next.setFullYear(now.getFullYear() + 1);
  return Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}
const serialize = (c) => ({ id: c.id, name: c.name, email: c.email, birthday: c.birthday, last_sent_year: c.last_sent_year, days_until: daysUntilBirthday(c.birthday) });

async function getSettings(mid) { const r = await db.one(`SELECT data FROM settings WHERE merchant_id=$1`, [mid]); return { ...DEFAULTS, ...(r?.data || {}) }; }

app.get("/api/contacts", core.requireSession, async (req, res) => {
  const rows = (await db.q(`SELECT * FROM contacts WHERE merchant_id=$1 ORDER BY name`, [req.session.merchantId])).map(serialize);
  const upcoming = rows.filter((c) => c.days_until <= 30).sort((a, b) => a.days_until - b.days_until);
  res.json({ contacts: rows, upcoming, ses_configured: sesConfigured(), stats: { total: rows.length, upcoming: upcoming.length, with_email: rows.filter((c) => c.email).length } });
});
app.post("/api/contacts", core.requireSession, async (req, res) => {
  const b = req.body || {};
  if (!String(b.name || "").trim() || !/^\d{4}-\d{2}-\d{2}$/.test(b.birthday)) return res.status(400).json({ error: "missing", message: "Name and birthday (date) are required." });
  await db.run(`INSERT INTO contacts (merchant_id, name, email, birthday) VALUES ($1,$2,$3,$4) ON CONFLICT (merchant_id, email) DO UPDATE SET name=$2, birthday=$4`,
    [req.session.merchantId, b.name.trim(), b.email || null, b.birthday]);
  res.status(201).json({ ok: true });
});
app.delete("/api/contacts/:id", core.requireSession, async (req, res) => {
  await db.run(`DELETE FROM contacts WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  res.json({ ok: true });
});

app.get("/api/settings", core.requireSession, async (req, res) => res.json({ settings: await getSettings(req.session.merchantId), ses_configured: sesConfigured() }));
app.post("/api/settings", core.requireSession, async (req, res) => {
  const b = req.body || {};
  const data = { subject: String(b.subject || DEFAULTS.subject).slice(0, 160), body: String(b.body || DEFAULTS.body).slice(0, 1000), code: String(b.code || "").slice(0, 40), days_before: Number(b.days_before) || 0 };
  await db.run(`INSERT INTO settings (merchant_id, data, updated_at) VALUES ($1,$2,now()) ON CONFLICT (merchant_id) DO UPDATE SET data=$2, updated_at=now()`, [req.session.merchantId, JSON.stringify(data)]);
  res.json({ settings: data });
});

app.post("/api/contacts/:id/send", core.requireSession, async (req, res) => {
  const c = await db.one(`SELECT * FROM contacts WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  if (!c) return res.status(404).json({ error: "not_found" });
  if (!c.email) return res.status(400).json({ error: "no_email", message: "This contact has no email." });
  if (!sesConfigured()) return res.status(400).json({ error: "email_off", message: "Email isn't configured." });
  const s = await getSettings(req.session.merchantId);
  const shop = merchantName(req);
  const fill = (t) => t.replace(/\{\{shop\}\}/g, shop).replace(/\{\{name\}\}/g, c.name).replace(/\{\{code\}\}/g, s.code || "");
  try {
    const out = await sendEmail({ to: c.email, subject: fill(s.subject), html: emailHtml(shop, c.name, fill(s.body), s.code) });
    await db.run(`UPDATE contacts SET last_sent_year=$1 WHERE id=$2`, [new Date().getFullYear(), c.id]);
    await db.run(`INSERT INTO sends (merchant_id, contact_id, email, code, message_id, sent_by_name) VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.session.merchantId, c.id, c.email, s.code, out.messageId, req.actor?.name || null]);
    res.json({ ok: true });
  } catch (err) { res.status(502).json({ error: "send_failed", message: err?.message }); }
});

app.get("/api/log", core.requireSession, async (req, res) => res.json({ log: await db.q(`SELECT * FROM sends WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.session.merchantId]) }));

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[birthday-promotions] listening on ${HOST}:${PORT}`));

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function emailHtml(shop, name, body, code) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;text-align:center;color:#1a1a1a;">
    <div style="font-size:40px;">🎂</div>
    <h2 style="margin:6px 0 10px;">Happy Birthday, ${esc(name)}!</h2>
    <p style="color:#555;margin:0 0 18px;">${esc(body)}</p>
    ${code ? `<div style="display:inline-block;border:2px dashed #c9a227;border-radius:12px;padding:14px 28px;margin:6px 0 16px;"><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.06em;">Your gift code</div><div style="font-size:24px;font-weight:800;letter-spacing:.04em;">${esc(code)}</div></div>` : ""}
    <p style="color:#aaa;font-size:12px;margin-top:18px;">with love from ${esc(shop)} · via Marketplace</p></div>`;
}
