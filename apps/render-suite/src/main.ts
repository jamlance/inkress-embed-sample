import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

/**
 * Render Suite — four marketplace listings served from one deploy,
 * path-routed:
 *   /invoices   → branded printable invoices from Inkress orders
 *   /receipts   → compact printable receipts from Inkress orders
 *   /donations  → donation log + printable donation receipts
 *   /gift-cards → issue gift card codes + printable cards
 *
 * Each oauth_client's embedded_entry_url ends in its path, so the
 * iframe loads at that path and we pick the mode from location.
 */

type Mode = "invoices" | "receipts" | "donations" | "gift-cards";

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchant: { id: number; name: string; logo?: string; currency: string } = { id: 0, name: "Merchant", currency: "JMD" };

function detectMode(): Mode {
  const p = location.pathname;
  if (p.startsWith("/receipts")) return "receipts";
  if (p.startsWith("/donations")) return "donations";
  if (p.startsWith("/gift-cards")) return "gift-cards";
  return "invoices";
}
const TITLES: Record<Mode, string> = {
  invoices: "Invoices", receipts: "Receipts", donations: "Donation Receipts", "gift-cards": "Gift Cards",
};

(async () => {
  let session;
  try { session = await initBv(); }
  catch (err: any) { root.innerHTML = fatal(TITLES[detectMode()], err?.message); return; }
  toast = makeToast(session.inkress);
  merchant = {
    id: session.merchant.id,
    name: session.merchant.name || session.merchant.username || "Merchant",
    logo: (session.merchant as any).logo,
    currency: session.merchant.currency_code || "JMD",
  };
  const mode = detectMode();
  renderHeader(mode);
  if (mode === "invoices" || mode === "receipts") await renderOrders(mode);
  else if (mode === "donations") await renderDonations();
  else await renderGiftCards();
})();

function renderHeader(mode: Mode) {
  root.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div><h1>${esc(TITLES[mode])}</h1><p class="bv-muted">${esc(merchant.name)} · printable, branded documents</p></div>
        <span class="bv-pill">by Bookerva</span>
      </header>
      <div id="body"><div class="bv-card"><div class="bv-skeleton" style="width:70%;"></div></div></div>
    </div>`;
}

/* ---------------- Orders → invoices / receipts ---------------- */
async function renderOrders(mode: Mode) {
  const body = document.getElementById("body")!;
  try {
    const { orders } = await bvApi<{ orders: any[] }>("/api/orders");
    if (!orders.length) { body.innerHTML = `<div class="bv-card bv-empty">No orders to ${mode === "invoices" ? "invoice" : "receipt"} yet.</div>`; return; }
    body.innerHTML = `<div class="bv-card"><table class="bv-table"><thead><tr><th>Ref</th><th>Customer</th><th>Date</th><th>Total</th><th></th></tr></thead>
      <tbody>${orders.map((o) => `<tr>
        <td><span class="bv-mono">#${esc(String(o.reference_id))}</span></td>
        <td>${esc(o.customer)}</td><td class="bv-muted">${esc(o.created)}</td>
        <td>${money(o.total, o.currency)}</td>
        <td style="text-align:right;"><button data-id="${o.id}" class="primary">Print ${mode === "invoices" ? "invoice" : "receipt"}</button></td>
      </tr>`).join("")}</tbody></table></div>`;
    body.querySelectorAll<HTMLButtonElement>("button[data-id]").forEach((b) =>
      b.addEventListener("click", () => printDoc(mode, orders.find((o) => String(o.id) === b.dataset.id))));
  } catch (err: any) { body.innerHTML = `<div class="bv-card bv-empty">Couldn't load orders: ${esc(err?.message || "error")}</div>`; }
}

function printDoc(mode: Mode, order: any) {
  if (!order) return;
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) { toast("Allow pop-ups to print", "warning"); return; }
  const lines = order.lines?.length ? order.lines : [{ title: "Order total", qty: 1, price: order.total }];
  const rows = lines.map((l: any) => `<tr><td>${esc(l.title)}</td><td style="text-align:center;">${l.qty}</td>
    <td style="text-align:right;">${money(l.price, order.currency)}</td><td style="text-align:right;">${money(l.price * l.qty, order.currency)}</td></tr>`).join("");
  const isInvoice = mode === "invoices";
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${isInvoice ? "Invoice" : "Receipt"} #${esc(String(order.reference_id))}</title>
    <style>
      body{font-family:Inter,system-ui,sans-serif;color:#1a1a1a;margin:0;padding:32px;max-width:${isInvoice ? "640px" : "360px"};}
      .head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;}
      .logo{max-height:48px;} h1{font-size:${isInvoice ? "22px" : "16px"};margin:0;}
      .muted{color:#666;font-size:13px;} table{width:100%;border-collapse:collapse;margin:16px 0;}
      th,td{padding:6px 4px;border-bottom:1px solid #eee;font-size:13px;text-align:left;}
      .total{font-weight:700;font-size:16px;text-align:right;margin-top:8px;}
      .foot{margin-top:24px;color:#888;font-size:11px;text-align:center;}
      @media print{body{padding:0;}}
    </style></head><body>
      <div class="head">
        <div>${merchant.logo ? `<img class="logo" src="${esc(merchant.logo)}" />` : `<h1>${esc(merchant.name)}</h1>`}
          <div class="muted">${esc(merchant.name)}</div></div>
        <div style="text-align:right;"><h1>${isInvoice ? "INVOICE" : "RECEIPT"}</h1>
          <div class="muted">#${esc(String(order.reference_id))}<br>${esc(order.created)}</div></div>
      </div>
      <div class="muted">Billed to: <strong>${esc(order.customer)}</strong></div>
      <table><thead><tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Amount</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <div class="total">Total: ${money(order.total, order.currency)}</div>
      <div class="foot">Thank you for your business · ${esc(merchant.name)} · powered by Bookerva</div>
      <script>window.onload=()=>window.print();</script>
    </body></html>`);
  w.document.close();
}

/* ---------------- Donations ---------------- */
async function renderDonations() {
  const body = document.getElementById("body")!;
  body.innerHTML = `
    <div class="bv-card">
      <h2 style="margin-top:0;">Record a donation</h2>
      <form id="d-form" class="bv-stack" style="max-width:560px;">
        <div class="bv-grid bv-grid-2">
          <div><label class="bv-label">Donor</label><input id="d-donor" placeholder="Donor name" /></div>
          <div><label class="bv-label">Amount (${esc(merchant.currency)})</label><input id="d-amount" type="number" step="0.01" /></div>
        </div>
        <div class="bv-grid bv-grid-2">
          <div><label class="bv-label">Date</label><input id="d-date" type="date" value="${new Date().toISOString().slice(0,10)}" /></div>
          <div><label class="bv-label">Note (optional)</label><input id="d-note" placeholder="e.g. Building fund" /></div>
        </div>
        <div class="bv-row"><button type="submit" class="primary">Record</button></div>
      </form>
    </div>
    <div id="stats" class="bv-grid bv-grid-2" style="margin:16px 0;">${statSkel(2)}</div>
    <h2 class="bv-section-title">Donations</h2>
    <div id="list" class="bv-card"><div class="bv-skeleton" style="width:60%;"></div></div>`;
  document.getElementById("d-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body2 = {
      donor: (document.getElementById("d-donor") as HTMLInputElement).value,
      amount: (document.getElementById("d-amount") as HTMLInputElement).value,
      received_on: (document.getElementById("d-date") as HTMLInputElement).value,
      note: (document.getElementById("d-note") as HTMLInputElement).value || null,
      currency: merchant.currency,
    };
    try { await bvApi("/api/donations", { method: "POST", body: JSON.stringify(body2) }); toast("Donation recorded", "success");
      (document.getElementById("d-form") as HTMLFormElement).reset();
      (document.getElementById("d-date") as HTMLInputElement).value = new Date().toISOString().slice(0,10); await loadDonations(); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  });
  await loadDonations();
}
async function loadDonations() {
  try {
    const { donations, stats } = await bvApi<{ donations: any[]; stats: any }>("/api/donations");
    document.getElementById("stats")!.innerHTML = statCard("Donations", String(stats.count)) + statCard("Total received", money(stats.total, merchant.currency));
    const el = document.getElementById("list")!;
    if (!donations.length) { el.innerHTML = `<div class="bv-empty">No donations recorded yet.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>Donor</th><th>Amount</th><th>Date</th><th>Note</th><th></th></tr></thead>
      <tbody>${donations.map((d) => `<tr><td><strong>${esc(d.donor)}</strong></td><td>${money(d.amount, d.currency)}</td>
        <td class="bv-muted">${esc(d.received_on)}</td><td class="bv-muted">${esc(d.note || "—")}</td>
        <td style="text-align:right;white-space:nowrap;"><button data-rcpt='${esc(JSON.stringify(d))}'>Receipt</button>
          <button data-del="${d.id}" class="destructive">Delete</button></td></tr>`).join("")}</tbody></table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-rcpt]").forEach((b) => b.addEventListener("click", () => printDonation(JSON.parse(b.dataset.rcpt!))));
    el.querySelectorAll<HTMLButtonElement>("button[data-del]").forEach((b) => b.addEventListener("click", async () => {
      try { await bvApi(`/api/donations/${b.dataset.del}`, { method: "DELETE" }); await loadDonations(); } catch (err: any) { toast(err?.message || "error", "error"); } }));
  } catch (err: any) { document.getElementById("list")!.innerHTML = `<div class="bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`; }
}
function printDonation(d: any) {
  const w = window.open("", "_blank", "width=640,height=800"); if (!w) { toast("Allow pop-ups to print", "warning"); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Donation Receipt</title>
    <style>body{font-family:Inter,system-ui,sans-serif;padding:40px;max-width:560px;color:#1a1a1a;}h1{font-size:20px;}.muted{color:#666;}
    .amount{font-size:28px;font-weight:700;margin:16px 0;}.foot{margin-top:32px;color:#888;font-size:11px;text-align:center;}</style></head>
    <body>${merchant.logo ? `<img src="${esc(merchant.logo)}" style="max-height:48px;" />` : `<h1>${esc(merchant.name)}</h1>`}
    <h1>Donation Receipt</h1><div class="muted">${esc(merchant.name)}</div>
    <p>Received with thanks from <strong>${esc(d.donor)}</strong> on ${esc(d.received_on)}.</p>
    <div class="amount">${money(d.amount, d.currency)}</div>
    ${d.note ? `<div class="muted">For: ${esc(d.note)}</div>` : ""}
    <div class="foot">This receipt confirms your generous donation · ${esc(merchant.name)} · via Bookerva</div>
    <script>window.onload=()=>window.print();</script></body></html>`);
  w.document.close();
}

/* ---------------- Gift cards ---------------- */
async function renderGiftCards() {
  const body = document.getElementById("body")!;
  body.innerHTML = `
    <div class="bv-card">
      <h2 style="margin-top:0;">Issue a gift card</h2>
      <form id="g-form" class="bv-stack" style="max-width:560px;">
        <div class="bv-grid bv-grid-2">
          <div><label class="bv-label">Amount (${esc(merchant.currency)})</label><input id="g-amount" type="number" step="0.01" /></div>
          <div><label class="bv-label">Recipient (optional)</label><input id="g-recipient" placeholder="Name" /></div>
        </div>
        <div><label class="bv-label">Message (optional)</label><input id="g-message" placeholder="Happy birthday!" /></div>
        <div class="bv-row"><button type="submit" class="primary">Issue card</button></div>
      </form>
    </div>
    <div id="stats" class="bv-grid bv-grid-3" style="margin:16px 0;">${statSkel(3)}</div>
    <h2 class="bv-section-title">Gift cards</h2>
    <div id="list" class="bv-card"><div class="bv-skeleton" style="width:60%;"></div></div>`;
  document.getElementById("g-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body2 = { amount: (document.getElementById("g-amount") as HTMLInputElement).value,
      recipient: (document.getElementById("g-recipient") as HTMLInputElement).value || null,
      message: (document.getElementById("g-message") as HTMLInputElement).value || null, currency: merchant.currency };
    try { const r = await bvApi<any>("/api/gift-cards", { method: "POST", body: JSON.stringify(body2) });
      toast(`Card ${r.code} issued`, "success"); (document.getElementById("g-form") as HTMLFormElement).reset(); await loadGiftCards(); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  });
  await loadGiftCards();
}
async function loadGiftCards() {
  try {
    const { cards, stats } = await bvApi<{ cards: any[]; stats: any }>("/api/gift-cards");
    document.getElementById("stats")!.innerHTML = statCard("Issued", String(stats.issued)) + statCard("Active", String(stats.active)) + statCard("Outstanding", money(stats.outstanding, merchant.currency));
    const el = document.getElementById("list")!;
    if (!cards.length) { el.innerHTML = `<div class="bv-empty">No gift cards yet. Issue one above.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>Code</th><th>Amount</th><th>Recipient</th><th>Status</th><th></th></tr></thead>
      <tbody>${cards.map((c) => `<tr><td><span class="bv-mono">${esc(c.code)}</span></td><td>${money(c.amount, c.currency)}</td>
        <td class="bv-muted">${esc(c.recipient || "—")}</td>
        <td><span class="bv-pill" data-tone="${c.redeemed ? "" : "success"}">${c.redeemed ? "Redeemed" : "Active"}</span></td>
        <td style="text-align:right;white-space:nowrap;"><button data-card='${esc(JSON.stringify(c))}'>Print</button>
          <button data-del="${c.id}" class="destructive">Delete</button></td></tr>`).join("")}</tbody></table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-card]").forEach((b) => b.addEventListener("click", () => printGiftCard(JSON.parse(b.dataset.card!))));
    el.querySelectorAll<HTMLButtonElement>("button[data-del]").forEach((b) => b.addEventListener("click", async () => {
      try { await bvApi(`/api/gift-cards/${b.dataset.del}`, { method: "DELETE" }); await loadGiftCards(); } catch (err: any) { toast(err?.message || "error", "error"); } }));
  } catch (err: any) { document.getElementById("list")!.innerHTML = `<div class="bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`; }
}
function printGiftCard(c: any) {
  const w = window.open("", "_blank", "width=520,height=360"); if (!w) { toast("Allow pop-ups to print", "warning"); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Gift Card</title>
    <style>body{font-family:Inter,system-ui,sans-serif;margin:0;padding:24px;}
    .card{width:420px;border-radius:16px;padding:28px;color:#fff;background:linear-gradient(135deg,#2563eb,#1e3a8a);box-shadow:0 8px 24px rgba(0,0,0,.2);}
    .label{text-transform:uppercase;letter-spacing:.08em;font-size:11px;opacity:.8;}
    .amount{font-size:34px;font-weight:800;margin:8px 0;}.code{font-family:monospace;font-size:18px;letter-spacing:.1em;background:rgba(255,255,255,.15);padding:8px 12px;border-radius:8px;display:inline-block;margin-top:12px;}
    .msg{margin-top:14px;font-style:italic;opacity:.9;}</style></head>
    <body><div class="card"><div class="label">${esc(merchant.name)} Gift Card</div>
      <div class="amount">${money(c.amount, c.currency)}</div>
      ${c.recipient ? `<div>For ${esc(c.recipient)}</div>` : ""}
      <div class="code">${esc(c.code)}</div>
      ${c.message ? `<div class="msg">"${esc(c.message)}"</div>` : ""}</div>
    <script>window.onload=()=>window.print();</script></body></html>`);
  w.document.close();
}

function statCard(l: string, v: string) { return `<div class="bv-card"><div class="bv-label">${esc(l)}</div><div style="font-size:24px;font-weight:600;">${esc(v)}</div></div>`; }
function statSkel(n: number) { return Array.from({ length: n }).map(() => `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div><div class="bv-skeleton" style="height:24px;width:40%;margin-top:6px;"></div></div>`).join(""); }
function money(n: number, c: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n || 0); } catch { return `${(n || 0).toFixed(2)} ${c}`; } }
function fatal(t: string, m?: string) { return `<div class="bv-shell"><div class="bv-card" style="text-align:center;"><h1>${esc(t)} couldn't load</h1><p class="bv-muted">${esc(m || "Unknown error")}</p></div></div>`; }
function esc(s: string) { return String(s ?? "").replace(/[&<>"']/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"); }
