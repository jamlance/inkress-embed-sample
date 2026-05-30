import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

interface Camp { id: number; name: string; description: string | null; deposit: number; full_price: number; currency: string; target_qty: number; available_on: string | null; status: string; reserved: number; deposits_collected: number; }
interface Signup { id: number; name: string; contact: string | null; qty: number; deposit_paid: number; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant", currency = "JMD";

(async () => {
  let session;
  try { session = await initBv(); }
  catch (err: any) { root.innerHTML = fatal("Pre-orders", err?.message); return; }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  currency = session.merchant.currency_code || "JMD";
  renderShell();
  await refresh();
})();

function renderShell() {
  root.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div><h1>Pre-orders</h1><p class="bv-muted">${esc(merchantName)} · collect deposits before you ship</p></div>
        <span class="bv-pill">by Bookerva</span>
      </header>
      <div id="stats" class="bv-grid bv-grid-3" style="margin-bottom:16px;">${statSkel(3)}</div>
      <div class="bv-card">
        <h2 style="margin-top:0;">New campaign</h2>
        <form id="camp-form" class="bv-stack" style="max-width:600px;">
          <div><label class="bv-label">Product name</label><input id="f-name" placeholder="Limited Edition Hoodie" /></div>
          <div><label class="bv-label">Description (optional)</label><input id="f-desc" placeholder="Ships in 3 weeks" /></div>
          <div class="bv-grid bv-grid-3">
            <div><label class="bv-label">Deposit (${esc(currency)})</label><input id="f-dep" type="number" step="0.01" placeholder="0.00" /></div>
            <div><label class="bv-label">Full price</label><input id="f-full" type="number" step="0.01" placeholder="0.00" /></div>
            <div><label class="bv-label">Target qty</label><input id="f-tgt" type="number" placeholder="0" /></div>
          </div>
          <div><label class="bv-label">Available on (optional)</label><input id="f-date" type="date" style="max-width:220px;" /></div>
          <div class="bv-row"><button type="submit" class="primary">Launch campaign</button></div>
        </form>
      </div>
      <h2 class="bv-section-title">Campaigns</h2>
      <div id="list" class="bv-card"><div class="bv-skeleton" style="width:70%;"></div></div>
      <div id="signups-panel"></div>
    </div>`;
  document.getElementById("camp-form")!.addEventListener("submit", onCreate);
}

async function refresh() {
  try {
    const { campaigns, stats } = await bvApi<{ campaigns: Camp[]; stats: any }>("/api/campaigns");
    document.getElementById("stats")!.innerHTML =
      statCard("Campaigns", String(stats.campaigns)) + statCard("Units reserved", String(stats.reserved)) + statCard("Deposits collected", money(stats.deposits, currency));
    const el = document.getElementById("list")!;
    if (!campaigns.length) { el.innerHTML = `<div class="bv-empty">No campaigns yet. Launch one above.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>Product</th><th>Deposit</th><th>Reserved</th><th>Status</th><th></th></tr></thead>
      <tbody>${campaigns.map((c) => `<tr>
        <td><strong>${esc(c.name)}</strong>${c.available_on ? `<div class="bv-muted">avail ${esc(c.available_on)}</div>` : ""}</td>
        <td>${money(c.deposit, c.currency)}</td>
        <td>${c.reserved}${c.target_qty ? ` / ${c.target_qty}` : ""}</td>
        <td><span class="bv-pill" data-tone="${c.status === "open" ? "success" : c.status === "fulfilled" ? "primary" : ""}">${esc(c.status)}</span></td>
        <td style="text-align:right;white-space:nowrap;">
          <button data-act="signups" data-id="${c.id}">Signups</button>
          ${c.status === "open" ? `<button data-act="close" data-id="${c.id}">Close</button>` : `<button data-act="open" data-id="${c.id}">Reopen</button>`}
          <button data-act="del" data-id="${c.id}" class="destructive">Delete</button>
        </td></tr>`).join("")}</tbody></table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", () => onAction(b)));
  } catch (err: any) { document.getElementById("list")!.innerHTML = `<div class="bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`; }
}

async function onCreate(e: Event) {
  e.preventDefault();
  const body = {
    name: (document.getElementById("f-name") as HTMLInputElement).value,
    description: (document.getElementById("f-desc") as HTMLInputElement).value || null,
    deposit: (document.getElementById("f-dep") as HTMLInputElement).value || 0,
    full_price: (document.getElementById("f-full") as HTMLInputElement).value || 0,
    target_qty: (document.getElementById("f-tgt") as HTMLInputElement).value || 0,
    available_on: (document.getElementById("f-date") as HTMLInputElement).value || null,
    currency,
  };
  try { await bvApi("/api/campaigns", { method: "POST", body: JSON.stringify(body) });
    toast("Campaign launched", "success"); (document.getElementById("camp-form") as HTMLFormElement).reset(); await refresh(); }
  catch (err: any) { toast(err?.message || "Couldn't launch", "error"); }
}

async function onAction(btn: HTMLButtonElement) {
  const id = Number(btn.dataset.id);
  const act = btn.dataset.act!;
  try {
    if (act === "signups") { await renderSignups(id); return; }
    if (act === "del") { await bvApi(`/api/campaigns/${id}`, { method: "DELETE" }); toast("Deleted", "success"); document.getElementById("signups-panel")!.innerHTML = ""; }
    if (act === "close") await bvApi(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ status: "closed" }) });
    if (act === "open") await bvApi(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ status: "open" }) });
    await refresh();
  } catch (err: any) { toast(err?.message || "error", "error"); }
}

async function renderSignups(id: number) {
  const panel = document.getElementById("signups-panel")!;
  panel.innerHTML = `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div></div>`;
  try {
    const { campaign, signups } = await bvApi<{ campaign: Camp; signups: Signup[] }>(`/api/campaigns/${id}/signups`);
    panel.innerHTML = `<div class="bv-card">
      <h2 style="margin-top:0;">${esc(campaign.name)} — signups</h2>
      <form id="su-form" class="bv-row" style="margin-bottom:12px;">
        <input id="su-name" placeholder="Customer name" style="flex:1;" />
        <input id="su-contact" placeholder="Phone / email" style="flex:1;" />
        <input id="su-qty" type="number" value="1" min="1" style="width:80px;" />
        <button type="submit" class="primary">Add</button>
      </form>
      ${signups.length ? `<table class="bv-table"><thead><tr><th>Name</th><th>Contact</th><th>Qty</th><th>Deposit</th><th></th></tr></thead>
        <tbody>${signups.map((s) => `<tr><td>${esc(s.name)}</td><td class="bv-muted">${esc(s.contact || "—")}</td><td>${s.qty}</td>
          <td>${s.deposit_paid ? `<span class="bv-pill" data-tone="success">Paid</span>` : `<span class="bv-pill" data-tone="warning">Unpaid</span>`}</td>
          <td style="text-align:right;"><button data-su="${s.id}" data-paid="${s.deposit_paid}">${s.deposit_paid ? "Mark unpaid" : "Mark paid"}</button></td></tr>`).join("")}</tbody></table>`
        : `<div class="bv-empty">No signups yet.</div>`}</div>`;
    document.getElementById("su-form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = { name: (document.getElementById("su-name") as HTMLInputElement).value, contact: (document.getElementById("su-contact") as HTMLInputElement).value || null, qty: (document.getElementById("su-qty") as HTMLInputElement).value };
      try { await bvApi(`/api/campaigns/${id}/signups`, { method: "POST", body: JSON.stringify(body) }); await renderSignups(id); await refresh(); }
      catch (err: any) { toast(err?.message || "Couldn't add", "error"); }
    });
    panel.querySelectorAll<HTMLButtonElement>("button[data-su]").forEach((b) => b.addEventListener("click", async () => {
      try { await bvApi(`/api/signups/${b.dataset.su}`, { method: "PATCH", body: JSON.stringify({ deposit_paid: b.dataset.paid === "1" ? 0 : 1 }) }); await renderSignups(id); await refresh(); }
      catch (err: any) { toast(err?.message || "error", "error"); }
    }));
  } catch (err: any) { panel.innerHTML = `<div class="bv-card bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`; }
}

function statCard(l: string, v: string) { return `<div class="bv-card"><div class="bv-label">${esc(l)}</div><div style="font-size:24px;font-weight:600;">${esc(v)}</div></div>`; }
function statSkel(n: number) { return Array.from({ length: n }).map(() => `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div><div class="bv-skeleton" style="height:24px;width:40%;margin-top:6px;"></div></div>`).join(""); }
function money(n: number, c: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n || 0); } catch { return `${(n || 0).toFixed(2)} ${c}`; } }
function fatal(t: string, m?: string) { return `<div class="bv-shell"><div class="bv-card" style="text-align:center;"><h1>${esc(t)} couldn't load</h1><p class="bv-muted">${esc(m || "Unknown error")}</p></div></div>`; }
function esc(s: string) { return String(s).replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"); }
