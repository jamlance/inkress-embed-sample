import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

interface Registry { id: number; slug: string; title: string; owner_name: string | null; event_date: string | null; item_count: number; claimed_count: number; }
interface Item { id: number; name: string; price: number | null; currency: string | null; claimed_by: string | null; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let openRegistry: number | null = null;

(async () => {
  let session;
  try { session = await initBv(); }
  catch (err: any) { root.innerHTML = fatal("Gift Registry", err?.message); return; }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  renderShell();
  await refresh();
})();

function renderShell() {
  root.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div><h1>Gift Registry</h1><p class="bv-muted">${esc(merchantName)} · registries for weddings, showers &amp; more</p></div>
        <span class="bv-pill">by Bookerva</span>
      </header>
      <div id="stats" class="bv-grid bv-grid-3" style="margin-bottom:16px;">${statSkel(3)}</div>
      <div class="bv-card">
        <h2 style="margin-top:0;">New registry</h2>
        <form id="reg-form" class="bv-stack" style="max-width:560px;">
          <div class="bv-grid bv-grid-2">
            <div><label class="bv-label">Title</label><input id="f-title" placeholder="Sasha & Andre's Wedding" /></div>
            <div><label class="bv-label">Owner (optional)</label><input id="f-owner" placeholder="Sasha" /></div>
          </div>
          <div><label class="bv-label">Event date (optional)</label><input id="f-date" type="date" style="max-width:220px;" /></div>
          <div class="bv-row"><button type="submit" class="primary">Create registry</button></div>
        </form>
      </div>
      <h2 class="bv-section-title">Registries</h2>
      <div id="list" class="bv-card"><div class="bv-skeleton" style="width:70%;"></div></div>
      <div id="items-panel"></div>
    </div>`;
  document.getElementById("reg-form")!.addEventListener("submit", onCreateReg);
}

async function refresh() {
  try {
    const { registries, stats } = await bvApi<{ registries: Registry[]; stats: any }>("/api/registries");
    document.getElementById("stats")!.innerHTML =
      statCard("Registries", String(stats.registries)) + statCard("Items", String(stats.items)) + statCard("Claimed", String(stats.claimed));
    const el = document.getElementById("list")!;
    if (!registries.length) { el.innerHTML = `<div class="bv-empty">No registries yet. Create one above.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>Title</th><th>Items</th><th>Claimed</th><th>Link</th><th></th></tr></thead>
      <tbody>${registries.map((r) => `
        <tr>
          <td><strong>${esc(r.title)}</strong>${r.event_date ? `<div class="bv-muted">${esc(r.event_date)}</div>` : ""}</td>
          <td>${r.item_count}</td>
          <td>${r.claimed_count}</td>
          <td><span class="bv-mono">/r/${esc(r.slug)}</span></td>
          <td style="text-align:right;white-space:nowrap;">
            <button data-act="items" data-id="${r.id}">Manage items</button>
            <button data-act="del" data-id="${r.id}" class="destructive">Delete</button>
          </td>
        </tr>`).join("")}</tbody></table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) =>
      b.addEventListener("click", () => onRegAction(b)));
  } catch (err: any) {
    document.getElementById("list")!.innerHTML = `<div class="bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`;
  }
}

async function onCreateReg(e: Event) {
  e.preventDefault();
  const body = {
    title: (document.getElementById("f-title") as HTMLInputElement).value,
    owner_name: (document.getElementById("f-owner") as HTMLInputElement).value || null,
    event_date: (document.getElementById("f-date") as HTMLInputElement).value || null,
  };
  try {
    await bvApi("/api/registries", { method: "POST", body: JSON.stringify(body) });
    toast("Registry created", "success");
    (document.getElementById("reg-form") as HTMLFormElement).reset();
    await refresh();
  } catch (err: any) { toast(err?.message || "Couldn't create", "error"); }
}

async function onRegAction(btn: HTMLButtonElement) {
  const id = Number(btn.dataset.id);
  if (btn.dataset.act === "del") {
    try { await bvApi(`/api/registries/${id}`, { method: "DELETE" }); toast("Deleted", "success");
      if (openRegistry === id) document.getElementById("items-panel")!.innerHTML = "";
      await refresh(); } catch (err: any) { toast(err?.message || "error", "error"); }
  } else { openRegistry = id; await renderItems(id); }
}

async function renderItems(id: number) {
  const panel = document.getElementById("items-panel")!;
  panel.innerHTML = `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div></div>`;
  try {
    const { registry, items } = await bvApi<{ registry: Registry; items: Item[] }>(`/api/registries/${id}/items`);
    panel.innerHTML = `
      <div class="bv-card">
        <h2 style="margin-top:0;">${esc(registry.title)} — items</h2>
        <form id="item-form" class="bv-row" style="margin-bottom:12px;">
          <input id="i-name" placeholder="Item name" style="flex:2;min-width:160px;" />
          <input id="i-price" type="number" step="0.01" placeholder="Price (optional)" style="flex:1;min-width:120px;" />
          <button type="submit" class="primary">Add item</button>
        </form>
        ${items.length ? `<table class="bv-table"><thead><tr><th>Item</th><th>Price</th><th>Status</th><th></th></tr></thead>
          <tbody>${items.map((it) => `<tr>
            <td>${esc(it.name)}</td>
            <td>${it.price != null ? money(it.price, it.currency || "JMD") : "—"}</td>
            <td>${it.claimed_by ? `<span class="bv-pill" data-tone="success">Claimed by ${esc(it.claimed_by)}</span>` : `<span class="bv-pill">Available</span>`}</td>
            <td style="text-align:right;"><button data-item="${it.id}" class="destructive">Remove</button></td>
          </tr>`).join("")}</tbody></table>` : `<div class="bv-empty">No items yet.</div>`}
      </div>`;
    document.getElementById("item-form")!.addEventListener("submit", (e) => onAddItem(e, id));
    panel.querySelectorAll<HTMLButtonElement>("button[data-item]").forEach((b) =>
      b.addEventListener("click", async () => {
        try { await bvApi(`/api/items/${b.dataset.item}`, { method: "DELETE" }); await renderItems(id); await refresh(); }
        catch (err: any) { toast(err?.message || "error", "error"); }
      }));
  } catch (err: any) { panel.innerHTML = `<div class="bv-card bv-empty">Couldn't load items: ${esc(err?.message || "error")}</div>`; }
}

async function onAddItem(e: Event, regId: number) {
  e.preventDefault();
  const body = {
    name: (document.getElementById("i-name") as HTMLInputElement).value,
    price: (document.getElementById("i-price") as HTMLInputElement).value || null,
  };
  try { await bvApi(`/api/registries/${regId}/items`, { method: "POST", body: JSON.stringify(body) });
    await renderItems(regId); await refresh(); }
  catch (err: any) { toast(err?.message || "Couldn't add", "error"); }
}

function statCard(l: string, v: string) { return `<div class="bv-card"><div class="bv-label">${esc(l)}</div><div style="font-size:24px;font-weight:600;">${esc(v)}</div></div>`; }
function statSkel(n: number) { return Array.from({ length: n }).map(() => `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div><div class="bv-skeleton" style="height:24px;width:40%;margin-top:6px;"></div></div>`).join(""); }
function money(n: number, c: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n); } catch { return `${n.toFixed(2)} ${c}`; } }
function fatal(t: string, m?: string) { return `<div class="bv-shell"><div class="bv-card" style="text-align:center;"><h1>${esc(t)} couldn't load</h1><p class="bv-muted">${esc(m || "Unknown error")}</p></div></div>`; }
function esc(s: string) { return String(s).replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"); }
