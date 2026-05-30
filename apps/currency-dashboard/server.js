/**
 * Currency Dashboard backend.
 *
 * Mounts the shared @bookerva-apps/core helpers (session exchange,
 * cookie-bound merchant context, embed-friendly CSP), then adds two
 * read-only API endpoints the iframe calls:
 *
 *   GET  /api/balances       → wallet balances per currency
 *   GET  /api/order-rollups  → paid / refunded / pending totals per
 *                              currency over the last 30 days
 *
 * The Inkress access token never leaves this server; the browser
 * only holds the bv_app_session cookie.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi, orderStatusName } from "@bookerva-apps/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const required = ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[currency-dashboard] Missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const app = express();

const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE,
  frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

// --- Balances ----------------------------------------------------------
app.get("/api/balances", core.requireSession, async (req, res) => {
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, "merchants/account/balances", {
      method: "POST",
      body: JSON.stringify({}),
    });
    // Normalise — the API returns a single balance object today (multi-
    // currency support varies). Wrap to an array for the dashboard.
    const raw = r?.result || r || {};
    const balances = Array.isArray(raw)
      ? raw
      : raw.currency
        ? [
            {
              currency_code: raw.currency,
              available: Number(raw.available || 0),
              pending: Number(raw.pending || 0),
            },
          ]
        : [];
    res.json({ balances });
  } catch (err) {
    res.status(502).json({ error: "balances_failed", message: err?.message });
  }
});

// --- Order rollups ----------------------------------------------------
app.get("/api/order-rollups", core.requireSession, async (req, res) => {
  const windowDays = 30;
  const since = new Date(Date.now() - windowDays * 86400 * 1000)
    .toISOString()
    .slice(0, 19) + "Z";

  try {
    // Pull recent orders, group by currency_code + status. We deliberately
    // cap at 500 to keep this fast; merchants with bigger volumes see
    // the most recent 500-paid-equivalents which is fine for a glance.
    const r = await inkressApi(
      core.cfg,
      req.session.accessToken,
      `orders?limit=500&order=id desc&updated_since=${encodeURIComponent(since)}`,
    );
    const orders = r?.result?.entries || [];

    const buckets = new Map();
    const norm = (o) => {
      // Map Inkress's order status to coarse buckets we care about.
      const s = orderStatusName(o);
      if (["paid", "confirmed", "prepared", "shipped", "delivered", "completed"].includes(s))
        return "paid";
      if (s === "refunded" || s === "returned") return "refunded";
      if (["pending", "verifying", "partial"].includes(s)) return "pending";
      return null;
    };

    for (const o of orders) {
      const cc = (o.currency?.code || o.currency_code || "JMD").toUpperCase();
      const bucket = buckets.get(cc) || {
        currency_code: cc,
        paid_count: 0,
        paid_total: 0,
        refunded_total: 0,
        pending_total: 0,
      };
      const total = Number(o.total || 0);
      const kind = norm(o);
      if (kind === "paid") {
        bucket.paid_count += 1;
        bucket.paid_total += total;
      } else if (kind === "refunded") {
        bucket.refunded_total += total;
      } else if (kind === "pending") {
        bucket.pending_total += total;
      }
      buckets.set(cc, bucket);
    }

    const rollups = Array.from(buckets.values()).sort(
      (a, b) => b.paid_total - a.paid_total,
    );
    res.json({ rollups, window_days: windowDays });
  } catch (err) {
    res.status(502).json({ error: "rollups_failed", message: err?.message });
  }
});

core.mountSpaFallback();

app.listen(PORT, HOST, () => {
  console.log(`[currency-dashboard] listening on http://${HOST}:${PORT}`);
});
