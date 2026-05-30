import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi, orderStatusName } from "@bookerva-apps/core";
import { openPg } from "@bookerva-apps/core/pgdb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[order-tagger] Missing env: ${k}`); process.exit(1); }
}

// Tags themselves live on the Inkress order's meta_data (source of truth).
// Postgres only holds the merchant's auto-tag RULES.
const db = await openPg("order_tagger", `
  CREATE TABLE IF NOT EXISTS rules (
    id              BIGSERIAL PRIMARY KEY,
    merchant_id     BIGINT NOT NULL,
    label           TEXT NOT NULL,
    min_total       NUMERIC,
    status_is       TEXT,
    currency_is     TEXT,
    repeat_customer BOOLEAN NOT NULL DEFAULT false,
    created_by_id   BIGINT,
    created_by_name TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_rules_merchant ON rules (merchant_id, id);
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE,
  frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

const DASH_BASE = process.env.INKRESS_DASHBOARD_BASE || "https://dev.inkress.com";

function mapOrder(o) {
  const meta = o.meta_data || {};
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  return {
    id: o.id,
    ref: o.reference_id || String(o.id),
    total: Number(o.total || 0),
    currency: o.currency?.code || o.currency_code || "JMD",
    status: orderStatusName(o),
    title: o.title || null,
    customer: o.customer
      ? {
          name: [o.customer.first_name, o.customer.last_name].filter(Boolean).join(" ") || o.customer.email || null,
          email: o.customer.email || null,
          phone: o.customer.phone || null,
          id: o.customer.id ?? null,
        }
      : null,
    created_at: o.inserted_at || o.created_at || null,
    tags,
    tag_log: Array.isArray(meta.tag_log) ? meta.tag_log : [],
    inkress_url: `${DASH_BASE}/dashboard/orders/${o.id}`,
  };
}

async function fetchOrders(session, limit = 50) {
  const r = await inkressApi(core.cfg, session.accessToken, `orders?limit=${limit}&order=id desc`);
  return (r?.result?.entries || []).map(mapOrder);
}
async function fetchOrderRaw(session, id) {
  const r = await inkressApi(core.cfg, session.accessToken, `orders/${encodeURIComponent(id)}`);
  return r?.result || null;
}

// Merge tags onto an order's meta_data and PATCH it back. `mutate(tags)` returns
// the new tags array; we append a tag_log entry per change. Returns new tags.
async function writeTags(session, actor, id, mutate, logEntries) {
  const raw = await fetchOrderRaw(session, id);
  if (!raw) throw new Error("order_not_found");
  const meta = raw.meta_data || {};
  const current = Array.isArray(meta.tags) ? meta.tags : [];
  const nextTags = mutate(current);
  const log = Array.isArray(meta.tag_log) ? meta.tag_log : [];
  const stamp = new Date().toISOString();
  for (const e of logEntries) log.push({ ...e, by: actor?.name || "staff", by_id: actor?.id || null, at: stamp });
  const meta_data = { ...meta, tags: nextTags, tag_log: log.slice(-50) };
  await inkressApi(core.cfg, session.accessToken, `orders/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify({ meta_data }),
  });
  return { tags: nextTags, tag_log: meta_data.tag_log };
}

function matchingLabels(order, rules, repeatEmails) {
  const out = [];
  for (const rl of rules) {
    if (rl.min_total != null && order.total < Number(rl.min_total)) continue;
    if (rl.status_is && order.status !== String(rl.status_is).toLowerCase()) continue;
    if (rl.currency_is && order.currency.toUpperCase() !== String(rl.currency_is).toUpperCase()) continue;
    if (rl.repeat_customer && !(order.customer?.email && repeatEmails.has(order.customer.email))) continue;
    out.push(rl.label);
  }
  return out;
}

// ---- Orders ----------------------------------------------------------------
app.get("/api/orders", core.requireSession, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  try {
    const orders = await fetchOrders(req.session, limit);
    const rules = await db.q(`SELECT * FROM rules WHERE merchant_id=$1 ORDER BY id`, [req.session.merchantId]);
    const counts = new Map();
    for (const o of orders) if (o.customer?.email) counts.set(o.customer.email, (counts.get(o.customer.email) || 0) + 1);
    const repeatEmails = new Set([...counts].filter(([, n]) => n > 1).map(([e]) => e));
    for (const o of orders) o.suggested = matchingLabels(o, rules, repeatEmails).filter((l) => !o.tags.includes(l));

    const allTags = [...new Set(orders.flatMap((o) => o.tags))].sort();
    res.json({
      orders,
      meta: {
        total: orders.length,
        tagged: orders.filter((o) => o.tags.length).length,
        untagged: orders.filter((o) => !o.tags.length).length,
        suggestions: orders.reduce((s, o) => s + o.suggested.length, 0),
        tags: allTags,
      },
    });
  } catch (err) { res.status(502).json({ error: "orders_failed", message: err?.message }); }
});

app.get("/api/orders/:id", core.requireSession, async (req, res) => {
  try {
    const raw = await fetchOrderRaw(req.session, req.params.id);
    if (!raw) return res.status(404).json({ error: "not_found" });
    const order = mapOrder(raw);
    order.lines = (raw.order_items || raw.line_items || raw.items || []).map((li) => ({
      title: li.title || li.product?.title || li.name || "Item",
      qty: Number(li.quantity ?? li.qty ?? 1),
      price: Number(li.price ?? li.unit_price ?? 0),
    }));
    res.json({ order });
  } catch (err) { res.status(502).json({ error: "order_failed", message: err?.message }); }
});

app.post("/api/orders/:id/tags", core.requireSession, async (req, res) => {
  const label = String(req.body?.label || "").trim().slice(0, 40);
  if (!label) return res.status(400).json({ error: "no_label", message: "Tag needs a label." });
  try {
    const out = await writeTags(req.session, req.actor, req.params.id,
      (cur) => (cur.includes(label) ? cur : [...cur, label]),
      [{ label, action: "add" }]);
    res.json(out);
  } catch (err) { res.status(502).json({ error: "tag_failed", message: err?.message }); }
});

app.delete("/api/orders/:id/tags/:label", core.requireSession, async (req, res) => {
  const label = String(req.params.label || "");
  try {
    const out = await writeTags(req.session, req.actor, req.params.id,
      (cur) => cur.filter((t) => t !== label),
      [{ label, action: "remove" }]);
    res.json(out);
  } catch (err) { res.status(502).json({ error: "untag_failed", message: err?.message }); }
});

// ---- Rules -----------------------------------------------------------------
app.get("/api/rules", core.requireSession, async (req, res) => {
  res.json({ rules: await db.q(`SELECT * FROM rules WHERE merchant_id=$1 ORDER BY id`, [req.session.merchantId]) });
});
app.post("/api/rules", core.requireSession, async (req, res) => {
  const b = req.body || {};
  const label = String(b.label || "").trim().slice(0, 40);
  if (!label) return res.status(400).json({ error: "no_label", message: "Rule needs a tag label." });
  const row = await db.one(
    `INSERT INTO rules (merchant_id, label, min_total, status_is, currency_is, repeat_customer, created_by_id, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.session.merchantId, label,
     b.min_total != null && b.min_total !== "" ? Number(b.min_total) : null,
     b.status_is || null, b.currency_is || null, !!b.repeat_customer,
     req.actor?.id || null, req.actor?.name || null]);
  res.status(201).json({ rule: row });
});
app.delete("/api/rules/:id", core.requireSession, async (req, res) => {
  await db.run(`DELETE FROM rules WHERE id=$1 AND merchant_id=$2`, [req.params.id, req.session.merchantId]);
  res.json({ ok: true });
});

app.post("/api/rules/apply", core.requireSession, async (req, res) => {
  const limit = Math.min(Number(req.body?.limit) || 50, 100);
  try {
    const orders = await fetchOrders(req.session, limit);
    const rules = await db.q(`SELECT * FROM rules WHERE merchant_id=$1 ORDER BY id`, [req.session.merchantId]);
    if (!rules.length) return res.json({ scanned: orders.length, tagged: 0, tags_added: 0 });
    const counts = new Map();
    for (const o of orders) if (o.customer?.email) counts.set(o.customer.email, (counts.get(o.customer.email) || 0) + 1);
    const repeatEmails = new Set([...counts].filter(([, n]) => n > 1).map(([e]) => e));

    let tagged = 0, added = 0;
    for (const o of orders) {
      const want = matchingLabels(o, rules, repeatEmails).filter((l) => !o.tags.includes(l));
      if (!want.length) continue;
      await writeTags(req.session, req.actor, o.id,
        (cur) => [...new Set([...cur, ...want])],
        want.map((label) => ({ label, action: "auto" })));
      tagged++; added += want.length;
    }
    res.json({ scanned: orders.length, tagged, tags_added: added });
  } catch (err) { res.status(502).json({ error: "apply_failed", message: err?.message }); }
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[order-tagger] listening on ${HOST}:${PORT}`));
