import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

interface Item { id: number; category: string; name: string; description: string | null; price: number; currency: string; available: number; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant", merchantId = 0, currency = "JMD";

(async () => {
  let session;
  try { session = await initBv(); }
  catch (err: any) { root.innerHTML = fatal("Restaurant Menu", err?.message); return; }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  merchantId = session.merchant.id;
  currency = session.merchant.currency_code || "JMD";
  renderShell();
  await refresh();
})();

function renderShell() {
  const qrTarget = `${location.origin}/m/${merchantId}`;
  root.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div><h1>Restaurant Menu</h1><p class="bv-muted">${esc(merchantName)} · build your menu, share a QR</p></div>
        <span class="bv-pill">by Bookerva</span>
      </header>
      <div id="stats" class="bv-grid bv-grid-3" style="margin-bottom:16px;">${statSkel(3)}</div>
      <div class="bv-card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div><div class="bv-label">Diner menu link (QR target)</div><span class="bv-mono">${esc(qrTarget)}</span></div>
        <a href="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrTarget)}" target="_blank" rel="noreferrer"><button>Open QR</button></a>
      </div>
      <div class="bv-card">
        <h2 style="margin-top:0;">Add menu item</h2>
        <form id="item-form" class="bv-stack" style="max-width:600px;">
          <div class="bv-grid bv-grid-2">
            <div><label class="bv-label">Name</label><input id="f-name" placeholder="Jerk Chicken" /></div>
            <div><label class="bv-label">Category</label><input id="f-cat" placeholder="Mains" value="Mains" /></div>
          </div>
          <div><label class="bv-label">Description (optional)</label><input id="f-desc" placeholder="Served with rice & peas" /></div>
          <div><label class="bv-label">Price (${esc(currency)})</label><input id="f-price" type="number" step="0.01" placeholder="0.00" style="max-width:220px;" /></div>
          <div class="bv-row"><button type="submit" class="primary">Add item</button></div>
        </form>
      </div>
      <h2 class="bv-section-title">Menu</h2>
      <div id="menu" class="bv-card"><div class="bv-skeleton" style="width:70%;"></div></div>
    </div>`;
  document.getElementById("item-form")!.addEventListener("submit", onAdd);
}

async function refresh() {
  try {
    const { items, stats } = await bvApi<{ items: Item[]; categories: string[]; stats: any }>("/api/menu");
    document.getElementById("stats")!.innerHTML =
      statCard("Items", String(stats.items)) + statCard("Available", String(stats.available)) + statCard("Categories", String(stats.categories));
    const el = document.getElementById("menu")!;
    if (!items.length) { el.innerHTML = `<div class="bv-empty">No items yet. Add your first dish above.</div>`; return; }
    const byCat = new Map<string, Item[]>();
    items.forEach((i) => { (byCat.get(i.category) || byCat.set(i.category, []).get(i.category)!).push(i); });
    el.innerHTML = [...byCat.entries()].map(([cat, its]) => `
      <div style="margin-bottom:14px;">
        <div class="bv-section-title" style="margin-top:0;">${esc(cat)}</div>
        <table class="bv-table"><tbody>${its.map((i) => `<tr>
          <td><strong>${esc(i.name)}</strong>${i.description ? `<div class="bv-muted">${esc(i.description)}</div>` : ""}</td>
          <td style="white-space:nowrap;">${money(i.price, i.currency)}</td>
          <td><span class="bv-pill" data-tone="${i.available ? "success" : ""}">${i.available ? "On menu" : "Off"}</span></td>
          <td style="text-align:right;white-space:nowrap;">
            <button data-act="toggle" data-id="${i.id}" data-av="${i.available}">${i.available ? "Hide" : "Show"}</button>
            <button data-act="del" data-id="${i.id}" class="destructive">Delete</button>
          </td></tr>`).join("")}</tbody></table>
      </div>`).join("");
    el.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", () => onAction(b)));
  } catch (err: any) { document.getElementById("menu")!.innerHTML = `<div class="bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`; }
}

async function onAdd(e: Event) {
  e.preventDefault();
  const body = {
    name: (document.getElementById("f-name") as HTMLInputElement).value,
    category: (document.getElementById("f-cat") as HTMLInputElement).value,
    description: (document.getElementById("f-desc") as HTMLInputElement).value || null,
    price: (document.getElementById("f-price") as HTMLInputElement).value || 0,
    currency,
  };
  try { await bvApi("/api/items", { method: "POST", body: JSON.stringify(body) });
    toast("Item added", "success"); (document.getElementById("item-form") as HTMLFormElement).reset();
    (document.getElementById("f-cat") as HTMLInputElement).value = "Mains"; await refresh(); }
  catch (err: any) { toast(err?.message || "Couldn't add", "error"); }
}

async function onAction(btn: HTMLButtonElement) {
  const id = btn.dataset.id!;
  try {
    if (btn.dataset.act === "toggle") await bvApi(`/api/items/${id}`, { method: "PATCH", body: JSON.stringify({ available: btn.dataset.av === "1" ? 0 : 1 }) });
    else { await bvApi(`/api/items/${id}`, { method: "DELETE" }); toast("Deleted", "success"); }
    await refresh();
  } catch (err: any) { toast(err?.message || "error", "error"); }
}

function statCard(l: string, v: string) { return `<div class="bv-card"><div class="bv-label">${esc(l)}</div><div style="font-size:24px;font-weight:600;">${esc(v)}</div></div>`; }
function statSkel(n: number) { return Array.from({ length: n }).map(() => `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div><div class="bv-skeleton" style="height:24px;width:40%;margin-top:6px;"></div></div>`).join(""); }
function money(n: number, c: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n); } catch { return `${n.toFixed(2)} ${c}`; } }
function fatal(t: string, m?: string) { return `<div class="bv-shell"><div class="bv-card" style="text-align:center;"><h1>${esc(t)} couldn't load</h1><p class="bv-muted">${esc(m || "Unknown error")}</p></div></div>`; }
function esc(s: string) { return String(s).replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"); }
