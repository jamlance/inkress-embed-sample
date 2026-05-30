import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, createInkressOrder, getInkressOrder, isPaidStatus } from "@bookerva-apps/core";
import { openPg } from "@bookerva-apps/core/pgdb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[promo-codes] Missing env: ${k}`); process.exit(1); }
}

const db = await openPg("promo_codes", `
  CREATE TABLE IF NOT EXISTS codes (
    id          BIGSERIAL PRIMARY KEY,
    merchant_id BIGINT NOT NULL,
    code        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'percent',
    value       NUMERIC NOT NULL,
    min_spend   NUMERIC NOT NULL DEFAULT 0,
    max_uses    INTEGER,
    used_count  INTEGER NOT NULL DEFAULT 0,
    expires_on  DATE,
    active      BOOLEAN NOT NULL DEFAULT true,
    currency    TEXT NOT NULL DEFAULT 'JMD',
    created_by_name TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (merchant_id, code)
  );
  CREATE TABLE IF NOT EXISTS redemptions (
    id          BIGSERIAL PRIMARY KEY,
    merchant_id BIGINT NOT NULL,
    code        TEXT NOT NULL,
    original    NUMERIC NOT NULL,
    discount    NUMERIC NOT NULL,
    net         NUMERIC NOT NULL,
    currency    TEXT NOT NULL,
    customer    TEXT,
    ref         TEXT,
    inkress_order_id TEXT,
    payment_url TEXT,
    state       TEXT NOT NULL DEFAULT 'awaiting',
    created_by_name TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_codes_merchant ON codes (merchant_id, id);
  CREATE INDEX IF NOT EXISTS idx_redemptions_merchant ON redemptions (merchant_id, created_at DESC);
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
const cleanCode = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");

function discountFor(code, amount) {
  if (!code.active) return { ok: false, reason: "inactive" };
  if (code.expires_on && new Date(code.expires_on) < new Date(new Date().toISOString().slice(0, 10))) return { ok: false, reason: "expired" };
  if (code.max_uses != null && code.used_count >= code.max_uses) return { ok: false, reason: "used_up" };
  if (amount < Number(code.min_spend)) return { ok: false, reason: "min_spend", min_spend: Number(code.min_spend) };
  const discount = code.kind === "percent" ? round2(amount * Number(code.value) / 100) : Math.min(round2(Number(code.value)), amount);
  return { ok: true, discount, net: round2(amount - discount) };
}

const serializeCode = (c) => ({ id: c.id, code: c.code, kind: c.kind, value: Number(c.value), min_spend: Number(c.min_spend), max_uses: c.max_uses, used_count: c.used_count, expires_on: c.expires_on, active: c.active, currency: c.currency });

// ---- Codes -----------------------------------------------------------------
app.get("/api/codes", core.requireSession, async (req, res) => {
  const codes = await db.q(`SELECT * FROM codes WHERE merchant_id=$1 ORDER BY id DESC`, [req.session.merchantId]);
  const reds = await db.q(`SELECT discount, state FROM redemptions WHERE merchant_id=$1`, [req.session.merchantId]);
  res.json({
    codes: codes.map(serializeCode),
    stats: {
      active: codes.filter((c) => c.active).length,
      redemptions: reds.length,
      discount_given: round2(reds.filter((r) => r.state === "paid").reduce((s, r) => s + Number(r.discount), 0)),
    },
  });
});
app.post("/api/codes", core.requireSession, async (req, res) => {
  const b = req.body || {};
  const code = cleanCode(b.code);
  if (!code) return res.status(400).json({ error: "no_code", message: "Enter a code." });
  const kind = b.kind === "fixed" ? "fixed" : "percent";
  const value = round2(b.value);
  if (!(value > 0)) return res.status(400).json({ error: "bad_value", message: "Enter a discount value." });
  try {
    const row = await db.one(
      `INSERT INTO codes (merchant_id, code, kind, value, min_spend, max_uses, expires_on, currency, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.session.merchantId, code, kind, value, round2(b.min_spend), b.max_uses ? Number(b.max_uses) : null,
       /^\d{4}-\d{2}-\d{2}$/.test(b.expires_on) ? b.expires_on : null,
       req.session.data?.merchant?.currency_code || "JMD", req.actor?.name || null]);
    res.status(201).json({ code: serializeCode(row) });
  } catch (err) {
    if (String(err.message).includes("uq") || String(err.code) === "23505") return res.status(409).json({ error: "duplicate", message: "That code already exists." });
    throw err;
  }
});
app.patch("/api/codes/:id", core.requireSession, async (req, res) => {
  const b = req.body || {};
  const row = await db.one(`SELECT * FROM codes WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  if (!row) return res.status(404).json({ error: "not_found" });
  const u = await db.one(`UPDATE codes SET active=$1, value=$2, min_spend=$3, max_uses=$4, expires_on=$5 WHERE id=$6 RETURNING *`,
    [b.active != null ? !!b.active : row.active, b.value != null ? round2(b.value) : row.value, b.min_spend != null ? round2(b.min_spend) : row.min_spend,
     b.max_uses !== undefined ? (b.max_uses ? Number(b.max_uses) : null) : row.max_uses, b.expires_on !== undefined ? (/^\d{4}-\d{2}-\d{2}$/.test(b.expires_on) ? b.expires_on : null) : row.expires_on, row.id]);
  res.json({ code: serializeCode(u) });
});
app.delete("/api/codes/:id", core.requireSession, async (req, res) => {
  await db.run(`DELETE FROM codes WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  res.json({ ok: true });
});

// ---- Validate (preview a discount) -----------------------------------------
app.post("/api/validate", core.requireSession, async (req, res) => {
  const code = await db.one(`SELECT * FROM codes WHERE merchant_id=$1 AND code=$2`, [req.session.merchantId, cleanCode(req.body?.code)]);
  if (!code) return res.json({ valid: false, reason: "not_found" });
  const amount = round2(req.body?.amount);
  const r = discountFor(code, amount);
  res.json(r.ok ? { valid: true, ...r, code: code.code } : { valid: false, reason: r.reason, min_spend: r.min_spend });
});

// ---- Charge with code (creates a discounted Inkress payment link) ----------
app.post("/api/charge", core.requireSession, async (req, res) => {
  const b = req.body || {};
  const amount = round2(b.amount);
  if (!(amount > 0)) return res.status(400).json({ error: "bad_amount", message: "Enter an amount." });
  const code = await db.one(`SELECT * FROM codes WHERE merchant_id=$1 AND code=$2`, [req.session.merchantId, cleanCode(b.code)]);
  if (!code) return res.status(400).json({ error: "bad_code", message: "Code not found." });
  const calc = discountFor(code, amount);
  if (!calc.ok) return res.status(400).json({ error: "code_invalid", reason: calc.reason, message: `Code can't be applied (${calc.reason}).` });

  const ref = `promo-${req.session.merchantId}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
  const name = String(b.customer?.name || "Customer").trim();
  const [first, ...rest] = name.split(/\s+/);
  const email = b.customer?.email || `promo+${ref}@bookerva.com`;
  let created;
  try {
    created = await createInkressOrder(core.cfg, req.session.accessToken, {
      referenceId: ref, total: calc.net, currencyCode: code.currency, kind: "online",
      title: `${name} — ${code.code} (-${fmtPlain(calc.discount, code.currency)})`,
      customer: { email, first_name: first || "Customer", last_name: rest.join(" ") || "", phone: b.customer?.phone || undefined },
      metaData: { source: "promo-codes", promo_code: code.code, original: amount, discount: calc.discount },
    });
  } catch (err) { return res.status(502).json({ error: "inkress_failed", message: err?.message }); }

  await db.run(`UPDATE codes SET used_count = used_count + 1 WHERE id=$1`, [code.id]);
  const red = await db.one(
    `INSERT INTO redemptions (merchant_id, code, original, discount, net, currency, customer, ref, inkress_order_id, payment_url, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [req.session.merchantId, code.code, amount, calc.discount, calc.net, code.currency, name, ref,
     created.id != null ? String(created.id) : null, created.payment_url || null, req.actor?.name || null]);
  res.json({ redemption: serializeRed(red), payment_url: created.payment_url });
});

const serializeRed = (r) => ({ id: r.id, code: r.code, original: Number(r.original), discount: Number(r.discount), net: Number(r.net), currency: r.currency, customer: r.customer, payment_url: r.payment_url, inkress_order_id: r.inkress_order_id, state: r.state, created_at: r.created_at });

app.get("/api/redemptions", core.requireSession, async (req, res) => {
  res.json({ redemptions: (await db.q(`SELECT * FROM redemptions WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.session.merchantId])).map(serializeRed) });
});
app.post("/api/redemptions/:id/poll", core.requireSession, async (req, res) => {
  const row = await db.one(`SELECT * FROM redemptions WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  if (!row || !row.inkress_order_id) return res.json({ changed: false });
  try {
    const ink = await getInkressOrder(core.cfg, req.session.accessToken, row.inkress_order_id);
    if (ink && isPaidStatus(ink) && row.state !== "paid") { await db.run(`UPDATE redemptions SET state='paid' WHERE id=$1`, [row.id]); return res.json({ changed: true }); }
    res.json({ changed: false });
  } catch (err) { res.status(502).json({ error: "poll_failed", message: err?.message }); }
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[promo-codes] listening on ${HOST}:${PORT}`));

function fmtPlain(n, c) { try { return new Intl.NumberFormat("en-JM", { style: "currency", currency: c }).format(n); } catch { return `${c} ${n}`; } }
