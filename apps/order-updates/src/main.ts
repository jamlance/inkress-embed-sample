import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, dataTable, card, openModal, flash,
  fmtMoney, relTime, pill, emptyState, h, iconEl,
} from "./bv-init";

interface Order { id: number; ref: string; status: string; total: number; currency: string; customer: { name: string; email: string | null } | null; created_at: string | null; }
interface Tmpl { enabled: boolean; subject: string; body: string; }
interface LogRow { id: number; order_ref: string; event: string; email: string; sent_by_name: string | null; created_at: string; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let sesOk = false;
let templates: Record<string, Tmpl> = {};
let events: string[] = ["paid", "confirmed", "prepared", "shipped", "delivered", "completed", "refunded", "cancelled"];
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
    brandIcon: "message",
    title: "Order Updates",
    subtitle: `${merchantName} · keep customers in the loop`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "orders", label: "Orders", icon: "receipt", render: renderOrders },
      { id: "templates", label: "Messages", icon: "message", render: renderTemplates },
      { id: "sent", label: "Sent", icon: "inbox", render: renderSent },
    ],
  });
})();

/* -------------------------------------------------------------------- Orders */
async function renderOrders(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { orders: Order[]; ses_configured: boolean };
  try { data = await bvApi("/api/orders"); sesOk = data.ses_configured; }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load orders", text: err?.message })); return; }
  host.innerHTML = "";
  if (!sesOk) host.append(h("div", { class: "ou-warn" }, iconEl("alert", 15), "Email sending isn't configured yet — updates are disabled until it is."));

  host.append(card({ title: "Recent orders", body: data.orders.length ? dataTable<Order>({
    columns: [
      { head: "Order", cell: (o) => h("div", null, h("strong", null, `#${o.ref}`), o.customer ? h("div", { class: "bv-muted" }, o.customer.name) : null) },
      { head: "Total", num: true, cell: (o) => fmtMoney(o.total, o.currency) },
      { head: "Status", cell: (o) => pill(o.status, o.status === "paid" || o.status === "completed" ? "ok" : o.status === "refunded" || o.status === "cancelled" ? "bad" : undefined) },
      { head: "Customer", cell: (o) => h("span", { class: "bv-muted" }, o.customer?.email || "no email") },
    ],
    rows: data.orders,
    rowActions: (o) => o.customer?.email ? h("button", { class: "ghost sm", disabled: !sesOk, onClick: () => openSend(o) }, iconEl("send", 14), "Update") : null,
  }) : emptyState({ icon: "receipt", title: "No orders yet", text: "Orders from Inkress show up here." }) }));
}

function openSend(o: Order) {
  const enabledEvents = events.filter((e) => templates[e]?.enabled !== false);
  const sel = h("select", null, ...events.map((e) => h("option", { value: e, selected: e === o.status }, e))) as HTMLSelectElement;
  const note = h("div", { class: "bv-muted", style: { marginTop: "8px", fontSize: "0.8125rem" } });
  const updateNote = () => { const t = templates[sel.value]; note.innerHTML = ""; note.append(t ? `“${t.subject.replace(/\{\{shop\}\}/g, merchantName)}”` : "Default message"); };
  sel.addEventListener("change", updateNote); updateNote();
  const body = h("div", null,
    h("p", null, "Send ", h("strong", null, o.customer?.name || "the customer"), " an update for order ", h("strong", null, `#${o.ref}`), "."),
    h("label", { class: "ou-field" }, h("span", { class: "bv-label" }, "Update type"), sel), note);
  openModal({ title: "Send order update", body, actions: [{ label: "Send update", primary: true, onClick: () => { void (async () => {
    try { await bvApi(`/api/orders/${o.id}/send`, { method: "POST", body: JSON.stringify({ event: sel.value }) }); flash(`Update sent to ${o.customer?.email}`, "success"); shell.select("sent"); }
    catch (err: any) { toast(err?.message || "Couldn't send", "error"); }
  })(); } }] });
}

/* ----------------------------------------------------------------- Templates */
async function renderTemplates(host: HTMLElement) {
  try { const r = await bvApi<{ templates: Record<string, Tmpl>; events: string[]; ses_configured: boolean }>("/api/templates"); templates = r.templates; events = r.events; sesOk = r.ses_configured; }
  catch (err: any) { host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }

  const editors: Record<string, { enabled: HTMLInputElement; subject: HTMLInputElement; body: HTMLTextAreaElement }> = {};
  const list = h("div", { class: "ou-templates" });
  for (const e of events) {
    const t = templates[e] || { enabled: false, subject: "", body: "" };
    const enabled = h("input", { type: "checkbox", checked: t.enabled }) as HTMLInputElement;
    const subject = h("input", { value: t.subject, placeholder: "Subject" }) as HTMLInputElement;
    const bodyEl = h("textarea", { rows: "2", placeholder: "Message" }, t.body) as HTMLTextAreaElement;
    editors[e] = { enabled, subject, body: bodyEl };
    list.append(h("div", { class: "ou-tmpl" },
      h("div", { class: "ou-tmpl-head" }, pill(e, e === "paid" || e === "completed" ? "ok" : e === "refunded" || e === "cancelled" ? "bad" : undefined), h("label", { class: "ou-toggle" }, enabled, " On")),
      subject, bodyEl));
  }
  const save = h("button", { class: "primary", onClick: async () => {
    const payload: any = { templates: {} };
    for (const e of events) { const ed = editors[e]!; payload.templates[e] = { enabled: ed.enabled.checked, subject: ed.subject.value, body: ed.body.value }; }
    try { const r = await bvApi<{ templates: Record<string, Tmpl> }>("/api/templates", { method: "POST", body: JSON.stringify(payload) }); templates = r.templates; flash("Messages saved", "success"); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  } }, "Save messages");

  host.append(card({ title: "Per-event messages", action: save, body: h("div", null,
    h("div", { class: "ou-hint bv-muted" }, "Use ", h("code", null, "{{name}}"), ", ", h("code", null, "{{ref}}"), ", ", h("code", null, "{{total}}"), ", ", h("code", null, "{{shop}}"), ". Send updates manually from the Orders tab; automatic on-event sending arrives with webhook pairing."),
    list) }));
}

/* --------------------------------------------------------------------- Sent */
async function renderSent(host: HTMLElement) {
  let log: LogRow[];
  try { log = (await bvApi<{ log: LogRow[] }>("/api/log")).log; }
  catch (err: any) { host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.append(card({ title: "Sent updates", body: log.length ? dataTable<LogRow>({
    columns: [
      { head: "When", cell: (r) => h("span", { class: "bv-muted" }, relTime(r.created_at)) },
      { head: "Order", cell: (r) => h("strong", null, `#${r.order_ref}`) },
      { head: "Event", cell: (r) => pill(r.event) },
      { head: "To", cell: (r) => h("span", { class: "bv-muted" }, r.email) },
      { head: "By", cell: (r) => h("span", { class: "bv-muted" }, r.sent_by_name || "—") },
    ], rows: log,
  }) : emptyState({ icon: "inbox", title: "No updates sent yet", text: "Send one from the Orders tab." }) }));
}

function fatal(msg?: string) { return h("div", { class: "bv-empty", style: { margin: "40px auto" } }, h("h3", null, "Order Updates couldn't load"), h("p", null, msg || "Open this app from the Inkress dashboard.")); }
