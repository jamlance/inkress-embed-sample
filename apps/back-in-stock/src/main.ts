import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, statRow, dataTable, card, openModal, flash,
  relTime, pill, emptyState, h, iconEl,
} from "./bv-init";

interface Product { id: string; title: string; stock: number | null; unlimited: boolean; watch_id: number | null; }
interface Watch { id: number; product_id: string; product_title: string; threshold: number; waiting: number; notified: number; public_url: string; }
interface WaitRow { id: number; email: string; notified_at: string | null; created_at: string; }
interface LogRow { id: number; product_title: string; count: number; sent_by_name: string | null; created_at: string; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let sesOk = false;
let shell: ReturnType<typeof mountShell>;

(async () => {
  let session;
  if (import.meta.env.DEV && !new URLSearchParams(location.search).has("inkress_session")) {
    const m = await import("./dev-mock"); m.installMockFetch(); session = m.mockSession();
  } else {
    try { session = await initBv(); }
    catch (err: any) { root.innerHTML = ""; root.append(fatal(err?.message)); return; }
  }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";

  shell = mountShell({
    brandIcon: "package",
    title: "Back in Stock",
    subtitle: `${merchantName} · capture demand while you're sold out`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "watches", label: "Watching", icon: "package", render: renderWatches },
      { id: "products", label: "Products", icon: "list", render: renderProducts },
      { id: "sent", label: "Alerts sent", icon: "inbox", render: renderSent },
    ],
  });
})();

/* ----------------------------------------------------------------- Watching */
async function renderWatches(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { watches: Watch[]; ses_configured: boolean };
  try { data = await bvApi("/api/watches"); sesOk = data.ses_configured; }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";

  const totalWaiting = data.watches.reduce((s, w) => s + w.waiting, 0);
  host.append(statRow([
    { k: "Products watched", v: String(data.watches.length), icon: "package" },
    { k: "Customers waiting", v: String(totalWaiting), tone: "accent", icon: "users" },
    { k: "Notified", v: String(data.watches.reduce((s, w) => s + w.notified, 0)), tone: "ok", icon: "send" },
  ]));

  if (!data.watches.length) { host.append(emptyState({ icon: "package", title: "Not watching anything yet", text: "Go to Products and watch an item that's out of stock.", action: h("button", { class: "primary", onClick: () => shell.select("products") }, "Browse products") })); return; }

  const grid = h("div", { class: "bs-grid" });
  for (const w of data.watches) {
    grid.append(h("div", { class: "bs-card" },
      h("div", { class: "bs-card-head" }, h("strong", null, w.product_title), pill(`${w.waiting} waiting`, w.waiting ? "accent" : undefined)),
      h("div", { class: "bs-link" }, h("input", { class: "bs-link-input", readonly: true, value: w.public_url }), h("button", { class: "ghost sm", title: "Copy link", onClick: () => { navigator.clipboard?.writeText(w.public_url); flash("Public link copied", "success"); } }, iconEl("copy", 14))),
      h("div", { class: "bs-actions" },
        h("button", { class: "primary sm", disabled: !sesOk || !w.waiting, title: !sesOk ? "Email not configured" : !w.waiting ? "No one waiting" : "", onClick: () => notify(w) }, iconEl("send", 14), "It's back — notify"),
        h("button", { class: "ghost sm", onClick: () => viewWaitlist(w) }, "Waitlist"),
        h("a", { class: "bs-open", href: w.public_url, target: "_blank", rel: "noopener" }, iconEl("external", 14)),
        h("button", { class: "ghost sm", onClick: async () => { await bvApi(`/api/watches/${w.id}`, { method: "DELETE" }); shell.select("watches"); } }, iconEl("trash", 14)))));
  }
  host.append(card({ title: "Watching", body: grid }));
}

async function notify(w: Watch) {
  try { const r = await bvApi<{ sent: number }>(`/api/watches/${w.id}/notify`, { method: "POST" }); flash(`Notified ${r.sent} customer${r.sent === 1 ? "" : "s"}`, "success"); shell.select("watches"); }
  catch (err: any) { toast(err?.message || "Couldn't notify", "error"); }
}
async function viewWaitlist(w: Watch) {
  let rows: WaitRow[] = [];
  try { rows = (await bvApi<{ waitlist: WaitRow[] }>(`/api/watches/${w.id}/waitlist`)).waitlist; } catch { /* */ }
  openModal({ title: `Waitlist · ${w.product_title}`, body: rows.length
    ? h("table", { class: "bv-table" }, h("tbody", null, ...rows.map((r) => h("tr", null, h("td", null, r.email), h("td", { class: "num" }, r.notified_at ? pill("notified", "ok") : pill("waiting", "accent"))))))
    : h("div", { class: "bv-muted" }, "No one waiting yet — share the public link."), actions: [{ label: "Close", onClick: () => {} }] });
}

/* ----------------------------------------------------------------- Products */
async function renderProducts(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { products: Product[] };
  try { data = await bvApi("/api/products"); }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load products", text: err?.message })); return; }
  host.innerHTML = "";
  host.append(card({ title: "Products", body: data.products.length ? dataTable<Product>({
    columns: [
      { head: "Product", cell: (p) => h("strong", null, p.title) },
      { head: "Stock", cell: (p) => p.unlimited ? h("span", { class: "bv-muted" }, "unlimited") : (p.stock! <= 0 ? pill("out of stock", "bad") : p.stock! <= 5 ? pill(`${p.stock} left`, "warn") : h("span", null, String(p.stock))) },
      { head: "", cell: (p) => p.watch_id ? pill("watching", "accent") : h("button", { class: "primary sm", onClick: () => watch(p) }, iconEl("plus", 13), "Watch") },
    ], rows: data.products,
  }) : emptyState({ icon: "list", title: "No products", text: "Add products in Inkress to watch their stock." }) }));
}
async function watch(p: Product) {
  try { await bvApi("/api/watches", { method: "POST", body: JSON.stringify({ product_id: p.id, product_title: p.title, threshold: 1 }) }); flash(`Watching ${p.title}`, "success"); shell.select("watches"); }
  catch (err: any) { toast(err?.message || "error", "error"); }
}

/* --------------------------------------------------------------------- Sent */
async function renderSent(host: HTMLElement) {
  let log: LogRow[];
  try { log = (await bvApi<{ log: LogRow[] }>("/api/log")).log; }
  catch (err: any) { host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.append(card({ title: "Alerts sent", body: log.length ? dataTable<LogRow>({
    columns: [
      { head: "When", cell: (r) => h("span", { class: "bv-muted" }, relTime(r.created_at)) },
      { head: "Product", cell: (r) => h("strong", null, r.product_title) },
      { head: "Notified", num: true, cell: (r) => `${r.count}` },
      { head: "By", cell: (r) => h("span", { class: "bv-muted" }, r.sent_by_name || "—") },
    ], rows: log,
  }) : emptyState({ icon: "inbox", title: "No alerts sent yet", text: "When a product is back, notify its waitlist from the Watching tab." }) }));
}

function fatal(msg?: string) { return h("div", { class: "bv-empty", style: { margin: "40px auto" } }, h("h3", null, "Back in Stock couldn't load"), h("p", null, msg || "Open this app from the Inkress dashboard.")); }
