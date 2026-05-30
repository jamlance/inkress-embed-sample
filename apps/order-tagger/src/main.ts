import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, statRow, dataTable, card, openModal, flash,
  fmtMoney, fmtDate, relTime, pill, emptyState, h, iconEl,
} from "./bv-init";

interface Customer { name: string | null; email: string | null; phone: string | null; }
interface TagLog { label: string; action: string; by: string; at: string; }
interface Order {
  id: number; ref: string; total: number; currency: string; status: string; title: string | null;
  customer: Customer | null; created_at: string | null; tags: string[]; suggested?: string[];
  tag_log: TagLog[]; inkress_url: string; lines?: { title: string; qty: number; price: number }[];
}
interface Meta { total: number; tagged: number; untagged: number; suggestions: number; tags: string[]; }
interface Rule {
  id: number; label: string; min_total: string | null; status_is: string | null;
  currency_is: string | null; repeat_customer: boolean;
}

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let currency = "JMD";
let filter = ""; // "", "untagged", or a tag label
let search = "";
let shell: ReturnType<typeof mountShell>;

const STATUSES = ["pending", "paid", "confirmed", "prepared", "shipped", "delivered", "completed", "cancelled", "refunded"];

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
  currency = session.merchant.currency_code || "JMD";

  shell = mountShell({
    brandIcon: "tag",
    title: "Order Tagger",
    subtitle: `${merchantName} · label & organise real orders`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "orders", label: "Orders", icon: "list", render: renderOrders },
      { id: "rules", label: "Auto-tag rules", icon: "settings", render: renderRules },
    ],
  });
})();

/* -------------------------------------------------------------------- Orders */
async function renderOrders(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading orders…"));
  let data: { orders: Order[]; meta: Meta };
  try { data = await bvApi("/api/orders?limit=50"); }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load orders", text: err?.message })); return; }
  host.innerHTML = "";

  host.append(statRow([
    { k: "Recent orders", v: String(data.meta.total), icon: "receipt" },
    { k: "Tagged", v: String(data.meta.tagged), tone: "ok", icon: "tag" },
    { k: "Untagged", v: String(data.meta.untagged), icon: "inbox" },
    { k: "Suggestions", v: String(data.meta.suggestions), tone: "accent", icon: "sparkles" },
  ]));

  // filter chips: All / Untagged / each tag in use
  const chips = h("div", { class: "tg-filters" },
    filterChip("All", ""),
    filterChip("Untagged", "untagged"),
    ...data.meta.tags.map((t) => filterChip(t, t)),
  );
  const searchInput = h("input", { class: "tg-search", placeholder: "Search ref, customer…", value: search }) as HTMLInputElement;
  let st: any;
  searchInput.addEventListener("input", () => { clearTimeout(st); st = setTimeout(() => { search = searchInput.value; rerenderRows(); }, 200); });

  let rows = applyFilter(data.orders);
  const tableHost = h("div");
  const renderTable = () => {
    tableHost.innerHTML = "";
    tableHost.append(rows.length ? ordersTable(rows) : emptyState({ icon: "tag", title: "No orders match", text: "Adjust the filter or search." }));
  };
  function rerenderRows() { rows = applyFilter(data.orders); renderTable(); }
  renderTable();

  host.append(card({
    title: "Orders",
    action: h("div", { class: "tg-toolbar" }, searchInput),
    body: [chips, tableHost],
  }));
}

function applyFilter(orders: Order[]): Order[] {
  const q = search.trim().toLowerCase();
  return orders.filter((o) => {
    if (filter === "untagged" && o.tags.length) return false;
    if (filter && filter !== "untagged" && !o.tags.includes(filter)) return false;
    if (q && !(`${o.ref} ${o.customer?.name ?? ""} ${o.customer?.email ?? ""}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function filterChip(label: string, value: string) {
  return h("button", { class: "tg-filter" + (filter === value ? " is-on" : ""), onClick: () => { filter = value; shell.select("orders"); } }, label);
}

function ordersTable(rows: Order[]) {
  return dataTable<Order>({
    columns: [
      { head: "Order", cell: (o) => h("div", null,
          h("strong", null, `#${o.ref}`),
          h("div", { class: "bv-muted" }, o.customer?.name || o.customer?.email || "—")) },
      { head: "Total", num: true, cell: (o) => fmtMoney(o.total, o.currency) },
      { head: "Status", cell: (o) => pill(o.status, o.status === "paid" || o.status === "completed" ? "ok" : o.status === "cancelled" || o.status === "refunded" ? "bad" : undefined) },
      { head: "Tags", cell: (o) => tagCell(o) },
      { head: "When", cell: (o) => h("span", { class: "bv-muted" }, o.created_at ? relTime(o.created_at) : "—") },
    ],
    rows,
    onRowClick: (o) => openOrder(o.id),
  });
}

function tagCell(o: Order) {
  const wrap = h("div", { class: "tg-tags", onClick: (e: Event) => e.stopPropagation() });
  for (const t of o.tags) {
    wrap.append(h("span", { class: "tg-tag" }, t,
      h("button", { class: "tg-tag-x", title: "Remove", onClick: () => removeTag(o.id, t) }, iconEl("x", 11))));
  }
  for (const s of o.suggested || []) {
    wrap.append(h("button", { class: "tg-tag is-suggested", title: "Apply suggested tag", onClick: () => addTag(o.id, s) }, iconEl("plus", 11), s));
  }
  wrap.append(h("button", { class: "tg-tag-add", title: "Add tag", onClick: () => promptAddTag(o.id) }, iconEl("plus", 12)));
  return wrap;
}

async function addTag(id: number, label: string) {
  try { await bvApi(`/api/orders/${id}/tags`, { method: "POST", body: JSON.stringify({ label }) }); flash(`Tagged “${label}”`, "success"); shell.select("orders"); }
  catch (err: any) { toast(err?.message || "Couldn't tag", "error"); }
}
async function removeTag(id: number, label: string) {
  try { await bvApi(`/api/orders/${id}/tags/${encodeURIComponent(label)}`, { method: "DELETE" }); flash(`Removed “${label}”`, "info"); shell.select("orders"); }
  catch (err: any) { toast(err?.message || "Couldn't remove", "error"); }
}
function promptAddTag(id: number) {
  const input = h("input", { placeholder: "e.g. VIP, wholesale, fraud-check", autofocus: true }) as HTMLInputElement;
  const quick = ["VIP", "wholesale", "gift", "fraud-check", "follow-up"];
  const body = h("div", null,
    h("label", { class: "bv-label" }, "Tag label"), input,
    h("div", { class: "tg-quick" }, ...quick.map((q) => h("button", { class: "tg-tag", onClick: () => { input.value = q; } }, q))));
  openModal({
    title: "Add a tag", body,
    actions: [{ label: "Add tag", primary: true, onClick: () => { const v = input.value.trim(); if (v) addTag(id, v); } }],
  });
}

async function openOrder(id: number) {
  let order: Order;
  try { order = (await bvApi<{ order: Order }>(`/api/orders/${id}`)).order; }
  catch (err: any) { toast(err?.message || "Couldn't load order", "error"); return; }

  const tagsHost = h("div", { class: "tg-tags" });
  const paintTags = () => {
    tagsHost.innerHTML = "";
    if (!order.tags.length) tagsHost.append(h("span", { class: "bv-muted" }, "No tags yet."));
    for (const t of order.tags) tagsHost.append(h("span", { class: "tg-tag" }, t,
      h("button", { class: "tg-tag-x", onClick: async () => { await detailRemove(order, t); paintTags(); } }, iconEl("x", 11))));
    tagsHost.append(h("button", { class: "tg-tag-add", onClick: () => detailAdd(order, paintTags) }, iconEl("plus", 12), "Add"));
  };
  paintTags();

  const lines = (order.lines && order.lines.length)
    ? h("table", { class: "bv-table tg-lines" }, h("tbody", null,
        ...order.lines.map((l) => h("tr", null, h("td", null, `${l.qty}× ${l.title}`), h("td", { class: "num" }, fmtMoney(l.price * l.qty, order.currency)))),
        h("tr", { class: "tg-lines-total" }, h("td", null, h("b", null, "Total")), h("td", { class: "num" }, h("b", null, fmtMoney(order.total, order.currency))))))
    : h("div", { class: "bv-muted" }, `Total ${fmtMoney(order.total, order.currency)}`);

  const history = order.tag_log.length
    ? h("div", { class: "tg-history" }, ...order.tag_log.slice().reverse().map((e) =>
        h("div", { class: "tg-history-row" },
          pill(e.action, e.action === "remove" ? "bad" : e.action === "auto" ? "accent" : "ok"),
          h("span", null, h("b", null, e.label)),
          h("span", { class: "bv-muted" }, `${e.by} · ${e.at ? fmtDate(e.at, true) : ""}`))))
    : h("div", { class: "bv-muted" }, "No tag history yet.");

  const body = h("div", { class: "tg-detail" },
    h("div", { class: "tg-detail-head" },
      h("div", null,
        order.customer ? h("strong", null, order.customer.name || order.customer.email || `#${order.ref}`) : h("strong", null, `#${order.ref}`),
        order.customer?.email ? h("div", { class: "bv-muted" }, order.customer.email) : null,
        h("div", { class: "bv-muted" }, `#${order.ref} · `, pill(order.status, order.status === "paid" ? "ok" : undefined))),
      h("a", { class: "tg-link", href: order.inkress_url, target: "_blank", rel: "noopener" }, iconEl("external", 14), "Open in Inkress")),
    lines,
    h("div", { class: "bv-label", style: { marginTop: "14px" } }, "Tags"), tagsHost,
    h("div", { class: "bv-label", style: { marginTop: "16px" } }, "History"), history,
  );
  openModal({ title: `Order #${order.ref}`, body, actions: [{ label: "Done", onClick: () => { shell.select("orders"); } }] });
}

async function detailAdd(order: Order, repaint: () => void) {
  const input = h("input", { placeholder: "e.g. VIP", autofocus: true }) as HTMLInputElement;
  const doAdd = async () => {
    const v = input.value.trim(); if (!v) return;
    try { const r = await bvApi<{ tags: string[]; tag_log: TagLog[] }>(`/api/orders/${order.id}/tags`, { method: "POST", body: JSON.stringify({ label: v }) }); order.tags = r.tags; order.tag_log = r.tag_log; repaint(); flash("Tagged", "success"); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  };
  openModal({
    title: "Add a tag", body: h("div", null, h("label", { class: "bv-label" }, "Tag label"), input),
    actions: [{ label: "Add", primary: true, onClick: () => { void doAdd(); } }],
  });
}
async function detailRemove(order: Order, label: string) {
  try { const r = await bvApi<{ tags: string[]; tag_log: TagLog[] }>(`/api/orders/${order.id}/tags/${encodeURIComponent(label)}`, { method: "DELETE" }); order.tags = r.tags; order.tag_log = r.tag_log; }
  catch (err: any) { toast(err?.message || "error", "error"); }
}

/* --------------------------------------------------------------------- Rules */
async function renderRules(host: HTMLElement) {
  let rules: Rule[] = [];
  try { rules = (await bvApi<{ rules: Rule[] }>("/api/rules")).rules; }
  catch (err: any) { host.append(emptyState({ icon: "alert", title: "Couldn't load rules", text: err?.message })); return; }

  const list = rules.length
    ? dataTable<Rule>({
        columns: [
          { head: "Tag", cell: (r) => h("span", { class: "tg-tag" }, r.label) },
          { head: "When", cell: (r) => h("span", { class: "bv-muted" }, ruleSummary(r)) },
        ],
        rows: rules,
        rowActions: (r) => h("button", { class: "ghost sm", onClick: async () => { await bvApi(`/api/rules/${r.id}`, { method: "DELETE" }); flash("Rule deleted", "info"); shell.select("rules"); } }, iconEl("trash", 14)),
      })
    : emptyState({ icon: "settings", title: "No auto-tag rules yet", text: "Add a rule to tag matching orders automatically." });

  const apply = h("button", { class: "primary", onClick: async () => {
    try { const r = await bvApi<{ scanned: number; tagged: number; tags_added: number }>("/api/rules/apply", { method: "POST", body: JSON.stringify({ limit: 50 }) });
      flash(`Scanned ${r.scanned} orders · tagged ${r.tagged} · ${r.tags_added} tags added`, "success"); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  } }, iconEl("sparkles", 16), "Apply rules to recent orders");

  host.append(
    card({ title: "Auto-tag rules", action: rules.length ? apply : undefined, body: list }),
    card({ title: "New rule", body: ruleForm() }),
  );
}

function ruleSummary(r: Rule): string {
  const parts: string[] = [];
  if (r.min_total != null) parts.push(`total ≥ ${fmtMoney(Number(r.min_total), currency)}`);
  if (r.status_is) parts.push(`status is ${r.status_is}`);
  if (r.currency_is) parts.push(`currency ${r.currency_is}`);
  if (r.repeat_customer) parts.push("repeat customer");
  return parts.length ? parts.join(" · ") : "every order";
}

function ruleForm() {
  const label = h("input", { placeholder: "Tag to apply, e.g. VIP" }) as HTMLInputElement;
  const minTotal = h("input", { type: "number", placeholder: "e.g. 10000", min: "0" }) as HTMLInputElement;
  const status = h("select", null, h("option", { value: "" }, "Any status"), ...STATUSES.map((s) => h("option", { value: s }, s))) as HTMLSelectElement;
  const cur = h("input", { placeholder: "e.g. JMD", maxlength: "3" }) as HTMLInputElement;
  const repeat = h("input", { type: "checkbox" }) as HTMLInputElement;

  const submit = h("button", { class: "primary", onClick: async () => {
    if (!label.value.trim()) { toast("Enter a tag label", "warning"); return; }
    try {
      await bvApi("/api/rules", { method: "POST", body: JSON.stringify({
        label: label.value.trim(),
        min_total: minTotal.value || null,
        status_is: status.value || null,
        currency_is: cur.value.trim().toUpperCase() || null,
        repeat_customer: repeat.checked,
      }) });
      flash("Rule added", "success"); shell.select("rules");
    } catch (err: any) { toast(err?.message || "error", "error"); }
  } }, "Add rule");

  return h("div", { class: "tg-ruleform" },
    h("div", { class: "tg-ruleform-grid" },
      labeled("Apply tag", label),
      labeled("Min total", minTotal),
      labeled("Order status", status),
      labeled("Currency", cur)),
    h("label", { class: "tg-check" }, repeat, " Only repeat customers (2+ orders in the recent window)"),
    h("div", { style: { marginTop: "12px" } }, submit));
}

/* -------------------------------------------------------------------- helpers */
function labeled(label: string, el: HTMLElement) {
  return h("label", { class: "tg-field" }, h("span", { class: "bv-label" }, label), el);
}
function fatal(msg?: string) {
  return h("div", { class: "bv-empty", style: { margin: "40px auto" } },
    h("h3", null, "Order Tagger couldn't load"),
    h("p", null, msg || "Open this app from the Inkress dashboard."));
}
