import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

interface Plan { id: number; name: string; cadence: string; price: number; currency: string; active: number; subscribers: number; }
interface Sub { id: number; name: string; contact: string | null; status: string; next_renewal: string | null; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant", currency = "JMD";

(async () => {
  let session;
  try { session = await initBv(); }
  catch (err: any) { root.innerHTML = fatal("Subscription Boxes", err?.message); return; }
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
        <div><h1>Subscription Boxes</h1><p class="bv-muted">${esc(merchantName)} · recurring plans &amp; subscribers</p></div>
        <span class="bv-pill">by Bookerva</span>
      </header>
      <div id="stats" class="bv-grid bv-grid-3" style="margin-bottom:16px;">${statSkel(3)}</div>
      <div class="bv-card">
        <h2 style="margin-top:0;">New plan</h2>
        <form id="plan-form" class="bv-stack" style="max-width:560px;">
          <div class="bv-grid bv-grid-2">
            <div><label class="bv-label">Name</label><input id="f-name" placeholder="Monthly Coffee Box" /></div>
            <div><label class="bv-label">Cadence</label><select id="f-cadence"><option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option></select></div>
          </div>
          <div><label class="bv-label">Price (${esc(currency)})</label><input id="f-price" type="number" step="0.01" placeholder="0.00" style="max-width:220px;" /></div>
          <div class="bv-row"><button type="submit" class="primary">Create plan</button></div>
        </form>
      </div>
      <h2 class="bv-section-title">Plans</h2>
      <div id="list" class="bv-card"><div class="bv-skeleton" style="width:70%;"></div></div>
      <div id="subs-panel"></div>
    </div>`;
  document.getElementById("plan-form")!.addEventListener("submit", onCreate);
}

async function refresh() {
  try {
    const { plans, stats } = await bvApi<{ plans: Plan[]; stats: any }>("/api/plans");
    document.getElementById("stats")!.innerHTML =
      statCard("Plans", String(stats.plans)) + statCard("Subscribers", String(stats.subscribers)) + statCard("Est. MRR", money(stats.mrr, currency));
    const el = document.getElementById("list")!;
    if (!plans.length) { el.innerHTML = `<div class="bv-empty">No plans yet. Create one above.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>Plan</th><th>Cadence</th><th>Price</th><th>Subscribers</th><th></th></tr></thead>
      <tbody>${plans.map((p) => `<tr>
        <td><strong>${esc(p.name)}</strong></td>
        <td class="bv-muted">${esc(p.cadence)}</td>
        <td>${money(p.price, p.currency)}</td>
        <td>${p.subscribers}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button data-act="subs" data-id="${p.id}">Subscribers</button>
          <button data-act="del" data-id="${p.id}" class="destructive">Delete</button>
        </td></tr>`).join("")}</tbody></table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", () => onPlanAction(b)));
  } catch (err: any) { document.getElementById("list")!.innerHTML = `<div class="bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`; }
}

async function onCreate(e: Event) {
  e.preventDefault();
  const body = {
    name: (document.getElementById("f-name") as HTMLInputElement).value,
    cadence: (document.getElementById("f-cadence") as HTMLSelectElement).value,
    price: (document.getElementById("f-price") as HTMLInputElement).value || 0,
    currency,
  };
  try { await bvApi("/api/plans", { method: "POST", body: JSON.stringify(body) });
    toast("Plan created", "success"); (document.getElementById("plan-form") as HTMLFormElement).reset(); await refresh(); }
  catch (err: any) { toast(err?.message || "Couldn't create", "error"); }
}

async function onPlanAction(btn: HTMLButtonElement) {
  const id = Number(btn.dataset.id);
  if (btn.dataset.act === "del") {
    try { await bvApi(`/api/plans/${id}`, { method: "DELETE" }); toast("Deleted", "success"); document.getElementById("subs-panel")!.innerHTML = ""; await refresh(); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  } else await renderSubs(id);
}

async function renderSubs(id: number) {
  const panel = document.getElementById("subs-panel")!;
  panel.innerHTML = `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div></div>`;
  try {
    const { plan, subscribers } = await bvApi<{ plan: Plan; subscribers: Sub[] }>(`/api/plans/${id}/subscribers`);
    panel.innerHTML = `<div class="bv-card">
      <h2 style="margin-top:0;">${esc(plan.name)} — subscribers</h2>
      <form id="sub-form" class="bv-row" style="margin-bottom:12px;">
        <input id="s-name" placeholder="Subscriber name" style="flex:1;" />
        <input id="s-contact" placeholder="Phone / email (optional)" style="flex:1;" />
        <button type="submit" class="primary">Add</button>
      </form>
      ${subscribers.length ? `<table class="bv-table"><thead><tr><th>Name</th><th>Contact</th><th>Next renewal</th><th>Status</th><th></th></tr></thead>
        <tbody>${subscribers.map((s) => `<tr>
          <td>${esc(s.name)}</td><td class="bv-muted">${esc(s.contact || "—")}</td>
          <td class="bv-muted">${esc(s.next_renewal || "—")}</td>
          <td><span class="bv-pill" data-tone="${s.status === "active" ? "success" : s.status === "cancelled" ? "destructive" : "warning"}">${esc(s.status)}</span></td>
          <td style="text-align:right;white-space:nowrap;">
            ${s.status === "active" ? `<button data-sub="${s.id}" data-st="paused">Pause</button>` : `<button data-sub="${s.id}" data-st="active">Resume</button>`}
            <button data-sub="${s.id}" data-st="cancelled" class="destructive">Cancel</button>
          </td></tr>`).join("")}</tbody></table>` : `<div class="bv-empty">No subscribers yet.</div>`}</div>`;
    document.getElementById("sub-form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = { name: (document.getElementById("s-name") as HTMLInputElement).value, contact: (document.getElementById("s-contact") as HTMLInputElement).value || null };
      try { await bvApi(`/api/plans/${id}/subscribers`, { method: "POST", body: JSON.stringify(body) }); await renderSubs(id); await refresh(); }
      catch (err: any) { toast(err?.message || "Couldn't add", "error"); }
    });
    panel.querySelectorAll<HTMLButtonElement>("button[data-sub]").forEach((b) => b.addEventListener("click", async () => {
      try { await bvApi(`/api/subscribers/${b.dataset.sub}`, { method: "PATCH", body: JSON.stringify({ status: b.dataset.st }) }); await renderSubs(id); await refresh(); }
      catch (err: any) { toast(err?.message || "error", "error"); }
    }));
  } catch (err: any) { panel.innerHTML = `<div class="bv-card bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`; }
}

function statCard(l: string, v: string) { return `<div class="bv-card"><div class="bv-label">${esc(l)}</div><div style="font-size:24px;font-weight:600;">${esc(v)}</div></div>`; }
function statSkel(n: number) { return Array.from({ length: n }).map(() => `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div><div class="bv-skeleton" style="height:24px;width:40%;margin-top:6px;"></div></div>`).join(""); }
function money(n: number, c: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n || 0); } catch { return `${(n || 0).toFixed(2)} ${c}`; } }
function fatal(t: string, m?: string) { return `<div class="bv-shell"><div class="bv-card" style="text-align:center;"><h1>${esc(t)} couldn't load</h1><p class="bv-muted">${esc(m || "Unknown error")}</p></div></div>`; }
function esc(s: string) { return String(s).replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"); }
