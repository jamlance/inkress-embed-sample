/**
 * Currency Dashboard — single-screen view of wallet balances + recent
 * order totals broken out by currency. Read-only. No persistence
 * beyond the live Inkress data.
 *
 * Calls the merchant's own server (`/api/balances`, `/api/orders`)
 * which proxies into Inkress with the session-cookie's access token.
 */

import "./index.css";
import { initBv, bvApi, makeToast } from "./bv-init";

interface Balance {
  currency_code: string;
  available: number;
  pending: number;
}

interface OrderRollup {
  currency_code: string;
  paid_count: number;
  paid_total: number;
  refunded_total: number;
  pending_total: number;
}

const root = document.getElementById("root")!;

(async () => {
  let session;
  try {
    session = await initBv();
  } catch (err: any) {
    renderFatal(err);
    return;
  }
  const toast = makeToast(session.inkress);
  renderShell(session);

  try {
    const [balances, rollups] = await Promise.all([
      bvApi<{ balances: Balance[] }>("/api/balances").catch(() => ({ balances: [] })),
      bvApi<{ rollups: OrderRollup[]; window_days: number }>("/api/order-rollups").catch(
        () => ({ rollups: [], window_days: 30 }),
      ),
    ]);
    renderData(balances.balances, rollups.rollups, rollups.window_days);
  } catch (err: any) {
    toast(`Couldn't load data: ${err?.message || "unknown"}`, "error");
  }
})();

function renderFatal(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as any)?.code ?? "bootstrap_error";
  root.innerHTML = `
    <div class="bv-shell">
      <div class="bv-card" style="text-align:center;">
        <h1>Couldn't load Currency Dashboard</h1>
        <p class="bv-muted">${escapeHtml(message)}</p>
        <p class="bv-muted"><span class="bv-mono">${escapeHtml(code)}</span></p>
      </div>
    </div>`;
}

function renderShell(s: Awaited<ReturnType<typeof initBv>>) {
  root.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div>
          <h1>Currency Dashboard</h1>
          <p class="bv-muted">${escapeHtml(s.merchant.name || s.merchant.username || "Merchant")}
            · Primary currency <span class="bv-pill" data-tone="primary">${escapeHtml(s.merchant.currency_code || "JMD")}</span>
          </p>
        </div>
        <span class="bv-pill">by Bookerva</span>
      </header>

      <section>
        <h2 class="bv-section-title">Wallet balances</h2>
        <div id="balances" class="bv-grid bv-grid-3">${skeletonCards(3)}</div>
      </section>

      <section>
        <h2 class="bv-section-title">Sales by currency · <span id="window-label">last 30 days</span></h2>
        <div id="rollups" class="bv-card">
          <div class="bv-skeleton" style="width: 60%; margin-bottom: 8px;"></div>
          <div class="bv-skeleton" style="width: 80%;"></div>
        </div>
      </section>
    </div>
  `;
}

function renderData(
  balances: Balance[],
  rollups: OrderRollup[],
  windowDays: number,
) {
  const bEl = document.getElementById("balances")!;
  const rEl = document.getElementById("rollups")!;
  document.getElementById("window-label")!.textContent = `last ${windowDays} days`;

  if (!balances.length) {
    bEl.innerHTML = `
      <div class="bv-card bv-empty">No wallets yet.</div>`;
  } else {
    bEl.innerHTML = balances
      .map(
        (b) => `
        <div class="bv-card">
          <div class="bv-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">${escapeHtml(b.currency_code)}</div>
          <div style="font-size:24px;font-weight:600;margin:6px 0 2px;">${fmt(b.available, b.currency_code)}</div>
          <div class="bv-muted">${fmt(b.pending, b.currency_code)} pending</div>
        </div>`,
      )
      .join("");
  }

  if (!rollups.length) {
    rEl.innerHTML = `<div class="bv-empty">No order activity in the last ${windowDays} days.</div>`;
    return;
  }
  rEl.innerHTML = `
    <table class="bv-table">
      <thead>
        <tr>
          <th>Currency</th>
          <th>Paid</th>
          <th>Orders</th>
          <th>Refunded</th>
          <th>Pending</th>
        </tr>
      </thead>
      <tbody>
        ${rollups
          .map(
            (r) => `
            <tr>
              <td><span class="bv-pill" data-tone="primary">${escapeHtml(r.currency_code)}</span></td>
              <td>${fmt(r.paid_total, r.currency_code)}</td>
              <td>${r.paid_count}</td>
              <td>${r.refunded_total ? fmt(r.refunded_total, r.currency_code) : "—"}</td>
              <td>${r.pending_total ? fmt(r.pending_total, r.currency_code) : "—"}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>`;
}

function skeletonCards(n: number) {
  return Array.from({ length: n })
    .map(
      () => `
      <div class="bv-card">
        <div class="bv-skeleton" style="width: 40%;"></div>
        <div class="bv-skeleton" style="width: 70%; height: 24px; margin-top: 6px;"></div>
        <div class="bv-skeleton" style="width: 40%; margin-top: 6px;"></div>
      </div>`,
    )
    .join("");
}

function fmt(n: number, currency: string): string {
  if (n == null || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
