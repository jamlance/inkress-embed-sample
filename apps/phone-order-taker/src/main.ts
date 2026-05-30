import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

interface Product { id: number; title: string; price: number; currency: string; }
interface CartLine { id: number; title: string; price: number; qty: number; }
interface Draft { id: number; customer: string; contact: string | null; items: CartLine[]; total: number; currency: string; status: string; created_at: string; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant", currency = "JMD";
let cart: CartLine[] = [];
let products: Product[] = [];

(async () => {
  let session;
  try { session = await initBv(); }
  catch (err: any) { root.innerHTML = fatal("Phone Order Taker", err?.message); return; }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  currency = session.merchant.currency_code || "JMD";
  renderShell();
  await Promise.all([loadProducts(""), refreshDrafts()]);
})();

function renderShell() {
  root.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div><h1>Phone Order Taker</h1><p class="bv-muted">${esc(merchantName)} · capture phone orders fast</p></div>
        <span class="bv-pill">by Bookerva</span>
      </header>
      <div id="stats" class="bv-grid bv-grid-3" style="margin-bottom:16px;">${statSkel(3)}</div>
      <div class="bv-grid bv-grid-2" style="margin-bottom:16px;align-items:start;">
        <div class="bv-card">
          <h2 style="margin-top:0;">Products</h2>
          <input id="prod-search" placeholder="Search products…" style="margin-bottom:10px;" autocomplete="off" />
          <div id="products"><div class="bv-skeleton" style="width:70%;"></div></div>
        </div>
        <div class="bv-card">
          <h2 style="margin-top:0;">New order</h2>
          <div class="bv-grid bv-grid-2" style="margin-bottom:8px;">
            <div><label class="bv-label">Customer</label><input id="o-customer" placeholder="Name" /></div>
            <div><label class="bv-label">Contact</label><input id="o-contact" placeholder="Phone / email" /></div>
          </div>
          <div id="cart"></div>
          <div id="cart-total" class="bv-row" style="justify-content:space-between;margin-top:10px;font-weight:600;"></div>
          <div class="bv-row" style="margin-top:10px;"><button id="save-order" class="primary">Save order</button></div>
        </div>
      </div>
      <h2 class="bv-section-title">Recent orders</h2>
      <div id="drafts" class="bv-card"><div class="bv-skeleton" style="width:70%;"></div></div>
    </div>`;
  const search = document.getElementById("prod-search") as HTMLInputElement;
  let t: any;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => loadProducts(search.value), 250); });
  document.getElementById("save-order")!.addEventListener("click", onSave);
  renderCart();
}

async function loadProducts(q: string) {
  const el = document.getElementById("products")!;
  try {
    const { products: ps } = await bvApi<{ products: Product[] }>(`/api/products${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    products = ps;
    if (!ps.length) { el.innerHTML = `<div class="bv-empty">No products found.</div>`; return; }
    el.innerHTML = ps.map((p) => `
      <div class="bv-row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid hsl(var(--border));">
        <div><strong>${esc(p.title)}</strong><div class="bv-muted">${money(p.price, p.currency)}</div></div>
        <button data-add="${p.id}">Add</button>
      </div>`).join("");
    el.querySelectorAll<HTMLButtonElement>("button[data-add]").forEach((b) =>
      b.addEventListener("click", () => addToCart(Number(b.dataset.add))));
  } catch (err: any) {
    el.innerHTML = `<div class="bv-empty">Couldn't load products: ${esc(err?.message || "error")}</div>`;
  }
}

function addToCart(id: number) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  const existing = cart.find((c) => c.id === id);
  if (existing) existing.qty += 1;
  else cart.push({ id: p.id, title: p.title, price: p.price, qty: 1 });
  renderCart();
}

function renderCart() {
  const el = document.getElementById("cart")!;
  if (!cart.length) { el.innerHTML = `<div class="bv-muted" style="padding:8px 0;">No items yet — add from the left.</div>`;
    document.getElementById("cart-total")!.innerHTML = ""; return; }
  el.innerHTML = cart.map((c) => `
    <div class="bv-row" style="justify-content:space-between;padding:4px 0;">
      <span>${esc(c.title)}</span>
      <span class="bv-row">
        <button data-dec="${c.id}">−</button><span style="min-width:24px;text-align:center;">${c.qty}</span><button data-inc="${c.id}">+</button>
        <span style="min-width:80px;text-align:right;">${money(c.price * c.qty, currency)}</span>
      </span></div>`).join("");
  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  document.getElementById("cart-total")!.innerHTML = `<span>Total</span><span>${money(total, currency)}</span>`;
  el.querySelectorAll<HTMLButtonElement>("button[data-inc]").forEach((b) => b.addEventListener("click", () => { const c = cart.find((x) => x.id === Number(b.dataset.inc)); if (c) { c.qty++; renderCart(); } }));
  el.querySelectorAll<HTMLButtonElement>("button[data-dec]").forEach((b) => b.addEventListener("click", () => {
    const c = cart.find((x) => x.id === Number(b.dataset.dec)); if (c) { c.qty--; if (c.qty <= 0) cart = cart.filter((x) => x.id !== c.id); renderCart(); } }));
}

async function onSave() {
  const customer = (document.getElementById("o-customer") as HTMLInputElement).value;
  const contact = (document.getElementById("o-contact") as HTMLInputElement).value || null;
  if (!customer.trim()) { toast("Enter a customer name", "warning"); return; }
  if (!cart.length) { toast("Add at least one item", "warning"); return; }
  try {
    await bvApi("/api/drafts", { method: "POST", body: JSON.stringify({ customer, contact, items: cart, currency }) });
    toast("Order saved", "success");
    cart = []; renderCart();
    (document.getElementById("o-customer") as HTMLInputElement).value = "";
    (document.getElementById("o-contact") as HTMLInputElement).value = "";
    await refreshDrafts();
  } catch (err: any) { toast(err?.message || "Couldn't save", "error"); }
}

async function refreshDrafts() {
  try {
    const { drafts, stats } = await bvApi<{ drafts: Draft[]; stats: any }>("/api/drafts");
    document.getElementById("stats")!.innerHTML =
      statCard("Open orders", String(stats.open)) + statCard("Open value", money(stats.total_value, currency)) + statCard("Total captured", String(stats.count));
    const el = document.getElementById("drafts")!;
    if (!drafts.length) { el.innerHTML = `<div class="bv-empty">No phone orders yet.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${drafts.map((d) => `<tr>
        <td><strong>${esc(d.customer)}</strong>${d.contact ? `<div class="bv-muted">${esc(d.contact)}</div>` : ""}</td>
        <td class="bv-muted">${d.items.map((i) => `${i.qty}× ${esc(i.title)}`).join(", ")}</td>
        <td>${money(d.total, d.currency)}</td>
        <td><span class="bv-pill" data-tone="${d.status === "open" ? "warning" : d.status === "fulfilled" ? "success" : "destructive"}">${esc(d.status)}</span></td>
        <td style="text-align:right;white-space:nowrap;">
          ${d.status === "open" ? `<button data-act="fulfilled" data-id="${d.id}">Fulfil</button>` : ""}
          <button data-act="del" data-id="${d.id}" class="destructive">Delete</button>
        </td></tr>`).join("")}</tbody></table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", async () => {
      try {
        if (b.dataset.act === "del") await bvApi(`/api/drafts/${b.dataset.id}`, { method: "DELETE" });
        else await bvApi(`/api/drafts/${b.dataset.id}`, { method: "PATCH", body: JSON.stringify({ status: b.dataset.act }) });
        await refreshDrafts();
      } catch (err: any) { toast(err?.message || "error", "error"); }
    }));
  } catch (err: any) { document.getElementById("drafts")!.innerHTML = `<div class="bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`; }
}

function statCard(l: string, v: string) { return `<div class="bv-card"><div class="bv-label">${esc(l)}</div><div style="font-size:24px;font-weight:600;">${esc(v)}</div></div>`; }
function statSkel(n: number) { return Array.from({ length: n }).map(() => `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div><div class="bv-skeleton" style="height:24px;width:40%;margin-top:6px;"></div></div>`).join(""); }
function money(n: number, c: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n || 0); } catch { return `${(n || 0).toFixed(2)} ${c}`; } }
function fatal(t: string, m?: string) { return `<div class="bv-shell"><div class="bv-card" style="text-align:center;"><h1>${esc(t)} couldn't load</h1><p class="bv-muted">${esc(m || "Unknown error")}</p></div></div>`; }
function esc(s: string) { return String(s).replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"); }
