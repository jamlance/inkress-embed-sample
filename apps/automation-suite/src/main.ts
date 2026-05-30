import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

type Mode = "digest" | "birthdays" | "tagger" | "restock" | "wa-updates";
const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchant = { name: "Merchant", email: "", currency: "JMD" };

function detectMode(): Mode {
  const p = location.pathname;
  if (p.startsWith("/birthdays")) return "birthdays";
  if (p.startsWith("/tagger")) return "tagger";
  if (p.startsWith("/restock")) return "restock";
  if (p.startsWith("/wa-updates")) return "wa-updates";
  return "digest";
}
const TITLES: Record<Mode, string> = {
  digest: "Daily Sales Digest", birthdays: "Birthday Promotions", tagger: "Order Tagger",
  restock: "Back-in-Stock Alerts", "wa-updates": "Order Update Messages",
};
const SUB: Record<Mode, string> = {
  digest: "a morning summary of yesterday's sales, by email",
  birthdays: "celebrate customers with an automatic birthday treat",
  tagger: "auto-label orders by rules you set",
  restock: "get told when a product runs low",
  "wa-updates": "message customers when their order status changes",
};

(async () => {
  let session;
  try { session = await initBv(); }
  catch (err: any) { root.innerHTML = fatal(TITLES[detectMode()], err?.message); return; }
  toast = makeToast(session.inkress);
  merchant = { name: session.merchant.name || session.merchant.username || "Merchant",
    email: (session.merchant as any).email || "", currency: session.merchant.currency_code || "JMD" };
  const mode = detectMode();
  header(mode);
  if (mode === "digest") await digest();
  else if (mode === "birthdays") await birthdays();
  else if (mode === "tagger") await tagger();
  else if (mode === "restock") await restock();
  else await waUpdates();
})();

function header(mode: Mode) {
  root.innerHTML = `<div class="bv-shell">
    <header class="bv-header"><div><h1>${esc(TITLES[mode])}</h1><p class="bv-muted">${esc(merchant.name)} · ${esc(SUB[mode])}</p></div>
    <span class="bv-pill">by Bookerva</span></header>
    <div id="body"><div class="bv-card"><div class="bv-skeleton" style="width:60%;"></div></div></div></div>`;
}

/* digest */
async function digest() {
  const body = document.getElementById("body")!;
  try {
    const d = await bvApi<any>("/api/digest/preview");
    body.innerHTML = `
      <div class="bv-grid bv-grid-3" style="margin-bottom:16px;">
        ${stat("Paid orders", String(d.paid_count))}${stat("Revenue", money(d.revenue, d.currency))}
        ${stat("Biggest order", d.biggest ? money(d.biggest.total, d.currency) : "—")}</div>
      <div class="bv-card">
        <h2 style="margin-top:0;">Send today's digest</h2>
        <p class="bv-muted" style="margin-top:0;">Summary of orders since ${esc(d.since)}. Sends a branded email.</p>
        <form id="f" class="bv-row">
          <input id="to" placeholder="Recipient email" value="${esc(merchant.email)}" style="flex:1;" />
          <button type="submit" class="primary">Send digest now</button>
        </form>
        <p class="bv-muted" style="font-size:12px;margin-top:8px;">Tip: schedule this each morning from your Bookerva account.</p>
      </div>`;
    document.getElementById("f")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const r = await bvApi<any>("/api/digest/send", { method: "POST", body: JSON.stringify({ to: (document.getElementById("to") as HTMLInputElement).value, summary: d }) });
        toast(`Digest sent to ${r.to}`, "success"); } catch (err: any) { toast(err?.message || "Send failed", "error"); }
    });
  } catch (err: any) { body.innerHTML = `<div class="bv-card bv-empty">Couldn't build digest: ${esc(err?.message || "error")}</div>`; }
}

/* birthdays */
async function birthdays() {
  const body = document.getElementById("body")!;
  body.innerHTML = `
    <div id="stats" class="bv-grid bv-grid-2" style="margin-bottom:16px;">${statSkel(2)}</div>
    <div class="bv-card"><h2 style="margin-top:0;">Add a customer birthday</h2>
      <form id="bf" class="bv-stack" style="max-width:560px;">
        <div class="bv-grid bv-grid-3">
          <div><label class="bv-label">Name</label><input id="b-name" /></div>
          <div><label class="bv-label">Email</label><input id="b-email" type="email" /></div>
          <div><label class="bv-label">Birthday</label><input id="b-date" type="date" /></div>
        </div><div class="bv-row"><button type="submit" class="primary">Add</button></div></form></div>
    <h2 class="bv-section-title">Birthdays</h2><div id="list" class="bv-card"><div class="bv-skeleton" style="width:60%;"></div></div>`;
  document.getElementById("bf")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = { name: (document.getElementById("b-name") as HTMLInputElement).value, email: (document.getElementById("b-email") as HTMLInputElement).value, birthday: (document.getElementById("b-date") as HTMLInputElement).value };
    try { await bvApi("/api/birthdays", { method: "POST", body: JSON.stringify(b) }); toast("Added", "success"); (document.getElementById("bf") as HTMLFormElement).reset(); await loadBdays(); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  });
  await loadBdays();
}
async function loadBdays() {
  try {
    const { birthdays: bs, stats } = await bvApi<any>("/api/birthdays");
    document.getElementById("stats")!.innerHTML = stat("Contacts", String(stats.total)) + stat("Upcoming (7 days)", String(stats.upcoming));
    const el = document.getElementById("list")!;
    if (!bs.length) { el.innerHTML = `<div class="bv-empty">No birthdays yet. Add customers above.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>Name</th><th>Email</th><th>Birthday</th><th></th></tr></thead><tbody>${bs.map((b: any) => `<tr>
      <td>${esc(b.name)}</td><td class="bv-muted">${esc(b.email || "—")}</td><td>${esc((b.birthday||"").slice(5))}</td>
      <td style="text-align:right;white-space:nowrap;">${b.email ? `<button data-send="${b.id}">Send treat</button>` : ""}<button data-del="${b.id}" class="destructive">Delete</button></td></tr>`).join("")}</tbody></table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-send]").forEach((x) => x.addEventListener("click", async () => {
      try { await bvApi(`/api/birthdays/${x.dataset.send}/send`, { method: "POST", body: JSON.stringify({ code: "BDAY10" }) }); toast("Birthday email sent", "success"); } catch (err: any) { toast(err?.message || "error", "error"); } }));
    el.querySelectorAll<HTMLButtonElement>("button[data-del]").forEach((x) => x.addEventListener("click", async () => {
      try { await bvApi(`/api/birthdays/${x.dataset.del}`, { method: "DELETE" }); await loadBdays(); } catch (err: any) { toast(err?.message || "error", "error"); } }));
  } catch (err: any) { document.getElementById("list")!.innerHTML = `<div class="bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`; }
}

/* tagger */
async function tagger() {
  const body = document.getElementById("body")!;
  body.innerHTML = `
    <div class="bv-card"><h2 style="margin-top:0;">Tag rule</h2>
      <form id="tf" class="bv-row" style="flex-wrap:wrap;">
        <input id="t-label" placeholder="Tag label e.g. VIP" style="flex:1;min-width:120px;" />
        <input id="t-min" type="number" step="0.01" placeholder="Min order total" style="width:160px;" />
        <input id="t-status" placeholder="Status is (optional)" style="width:160px;" />
        <button type="submit" class="primary">Add rule</button></form>
      <div id="rules" style="margin-top:12px;"></div></div>
    <h2 class="bv-section-title">Recent orders (tagged live)</h2><div id="applied" class="bv-card"><div class="bv-skeleton" style="width:60%;"></div></div>`;
  document.getElementById("tf")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = { label: (document.getElementById("t-label") as HTMLInputElement).value, min_total: (document.getElementById("t-min") as HTMLInputElement).value || 0, status_is: (document.getElementById("t-status") as HTMLInputElement).value || null };
    try { await bvApi("/api/tag-rules", { method: "POST", body: JSON.stringify(b) }); toast("Rule added", "success"); (document.getElementById("tf") as HTMLFormElement).reset(); await loadRules(); await applyTags(); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  });
  await loadRules(); await applyTags();
}
async function loadRules() {
  const { rules } = await bvApi<any>("/api/tag-rules");
  const el = document.getElementById("rules")!;
  el.innerHTML = rules.length ? rules.map((r: any) => `<span class="bv-pill" data-tone="primary" style="margin-right:6px;">${esc(r.label)} · ≥${r.min_total}${r.status_is ? ` · ${esc(r.status_is)}` : ""} <button data-del="${r.id}" style="border:0;background:none;padding:0 0 0 4px;cursor:pointer;">✕</button></span>`).join("") : `<span class="bv-muted">No rules yet.</span>`;
  el.querySelectorAll<HTMLButtonElement>("button[data-del]").forEach((b) => b.addEventListener("click", async () => { await bvApi(`/api/tag-rules/${b.dataset.del}`, { method: "DELETE" }); await loadRules(); await applyTags(); }));
}
async function applyTags() {
  const el = document.getElementById("applied")!;
  try {
    const { orders } = await bvApi<any>("/api/tagger/apply");
    if (!orders.length) { el.innerHTML = `<div class="bv-empty">No recent orders.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>Order</th><th>Total</th><th>Status</th><th>Tags</th></tr></thead><tbody>${orders.map((o: any) => `<tr>
      <td><span class="bv-mono">#${esc(String(o.ref))}</span></td><td>${money(o.total, o.currency)}</td><td class="bv-muted">${esc(o.status)}</td>
      <td>${o.tags.length ? o.tags.map((t: string) => `<span class="bv-pill" data-tone="success">${esc(t)}</span>`).join(" ") : "—"}</td></tr>`).join("")}</tbody></table>`;
  } catch (err: any) { el.innerHTML = `<div class="bv-empty">Couldn't load orders: ${esc(err?.message || "error")}</div>`; }
}

/* restock */
async function restock() {
  const body = document.getElementById("body")!;
  body.innerHTML = `
    <div class="bv-card"><h2 style="margin-top:0;">Low-stock watch</h2>
      <p class="bv-muted" style="margin-top:0;">Live stock from your catalogue. Add a watch to flag items at or below a threshold.</p>
      <div id="products"><div class="bv-skeleton" style="width:60%;"></div></div></div>
    <h2 class="bv-section-title">Watched products</h2><div id="rules" class="bv-card"><div class="bv-skeleton" style="width:50%;"></div></div>`;
  await Promise.all([loadProducts(), loadRestockRules()]);
}
async function loadProducts() {
  const el = document.getElementById("products")!;
  try {
    const { products } = await bvApi<any>("/api/products");
    if (!products.length) { el.innerHTML = `<div class="bv-empty">No products found.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>Product</th><th>Stock</th><th></th></tr></thead><tbody>${products.map((p: any) => `<tr>
      <td>${esc(p.title)}</td><td><span class="bv-pill" data-tone="${p.stock <= 5 ? "warning" : "success"}">${p.stock}</span></td>
      <td style="text-align:right;"><button data-watch='${esc(JSON.stringify(p))}'>Watch</button></td></tr>`).join("")}</tbody></table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-watch]").forEach((b) => b.addEventListener("click", async () => {
      const p = JSON.parse(b.dataset.watch!);
      try { await bvApi("/api/restock-rules", { method: "POST", body: JSON.stringify({ product_id: p.id, product_title: p.title, threshold: 5 }) }); toast(`Watching ${p.title}`, "success"); await loadRestockRules(); } catch (err: any) { toast(err?.message || "error", "error"); } }));
  } catch (err: any) { el.innerHTML = `<div class="bv-empty">Couldn't load products: ${esc(err?.message || "error")}</div>`; }
}
async function loadRestockRules() {
  const { rules } = await bvApi<any>("/api/restock-rules");
  const el = document.getElementById("rules")!;
  if (!rules.length) { el.innerHTML = `<div class="bv-empty">No watches yet. Add one from the catalogue above.</div>`; return; }
  el.innerHTML = `<table class="bv-table"><thead><tr><th>Product</th><th>Alert at</th><th></th></tr></thead><tbody>${rules.map((r: any) => `<tr>
    <td>${esc(r.product_title)}</td><td>${r.threshold} left</td><td style="text-align:right;"><button data-del="${r.id}" class="destructive">Stop</button></td></tr>`).join("")}</tbody></table>`;
  el.querySelectorAll<HTMLButtonElement>("button[data-del]").forEach((b) => b.addEventListener("click", async () => { await bvApi(`/api/restock-rules/${b.dataset.del}`, { method: "DELETE" }); await loadRestockRules(); }));
}

/* wa-updates */
async function waUpdates() {
  const body = document.getElementById("body")!;
  const { config } = await bvApi<any>("/api/config/wa-updates").catch(() => ({ config: {} }));
  const events = ["orders.paid", "orders.shipped", "orders.refunded", "orders.cancelled"];
  body.innerHTML = `
    <div class="bv-card">
      <h2 style="margin-top:0;">Which order updates to send</h2>
      <p class="bv-muted" style="margin-top:0;">Pick the moments worth a message. Connect your WhatsApp Business number in your Bookerva account to deliver over WhatsApp; until then these go by email.</p>
      <div class="bv-stack" style="max-width:440px;">
        ${events.map((ev) => `<label class="bv-row" style="justify-content:space-between;">
          <span>${esc(ev.replace("orders.", "Order "))}</span>
          <input type="checkbox" data-ev="${ev}" ${config?.[ev] ? "checked" : ""} style="width:auto;" /></label>`).join("")}
      </div>
      <div class="bv-row" style="margin-top:12px;"><button id="save" class="primary">Save preferences</button></div>
    </div>
    <div class="bv-card"><h2 style="margin-top:0;">WhatsApp connection</h2>
      <p class="bv-muted" style="margin-top:0;">Status: <span class="bv-pill" data-tone="warning">Not connected</span></p>
      <p class="bv-muted">Pair your WhatsApp Business number from the Bookerva dashboard to upgrade delivery from email to WhatsApp.</p></div>`;
  document.getElementById("save")!.addEventListener("click", async () => {
    const cfg: Record<string, boolean> = {};
    body.querySelectorAll<HTMLInputElement>("input[data-ev]").forEach((c) => { cfg[c.dataset.ev!] = c.checked; });
    try { await bvApi("/api/config/wa-updates", { method: "PUT", body: JSON.stringify({ config: cfg }) }); toast("Preferences saved", "success"); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  });
}

function stat(l: string, v: string) { return `<div class="bv-card"><div class="bv-label">${esc(l)}</div><div style="font-size:24px;font-weight:600;">${esc(v)}</div></div>`; }
function statSkel(n: number) { return Array.from({ length: n }).map(() => `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div><div class="bv-skeleton" style="height:24px;width:40%;margin-top:6px;"></div></div>`).join(""); }
function money(n: number, c: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n || 0); } catch { return `${(n || 0).toFixed(2)} ${c}`; } }
function fatal(t: string, m?: string) { return `<div class="bv-shell"><div class="bv-card" style="text-align:center;"><h1>${esc(t)} couldn't load</h1><p class="bv-muted">${esc(m || "Unknown error")}</p></div></div>`; }
function esc(s: string) { return String(s ?? "").replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"); }
