import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, statRow, dataTable, card, flash,
  fmtMoney, fmtDate, relTime, pill, emptyState, h, iconEl,
} from "./bv-init";

interface Digest {
  range: string; currency: string; revenue: number; orders: number; paid: number; aov: number;
  refunds: number; new_customers: number;
  biggest: { ref: string | number; total: number; customer: string | null } | null;
  by_day: { date: string; total: number }[];
  top_products: { title: string; qty: number }[];
}
interface Recipient { id: number; email: string; name: string | null; enabled: boolean; source: string; }
interface Settings { frequency: string; time: string; range: string; currency: string | null; }
interface LogRow { id: number; range_label: string; currency: string; revenue: string; orders: number; recipients: string[]; message_ids: { email: string; id: string }[]; sent_by_name: string | null; created_at: string; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let currency = "JMD";
let range = "7d";
let sesOk = false;
let shell: ReturnType<typeof mountShell>;

const RANGES: [string, string][] = [["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]];

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
    brandIcon: "chart",
    title: "Sales Digest",
    subtitle: `${merchantName} · know your numbers, on a schedule`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "overview", label: "Overview", icon: "chart", render: renderOverview },
      { id: "recipients", label: "Recipients", icon: "users", render: renderRecipients },
      { id: "schedule", label: "Schedule", icon: "clock", render: renderSchedule },
      { id: "log", label: "Send log", icon: "inbox", render: renderLog },
    ],
  });
})();

/* ------------------------------------------------------------------ Overview */
async function renderOverview(host: HTMLElement) {
  const rangeBar = h("div", { class: "sd-ranges" },
    ...RANGES.map(([v, label]) => h("button", { class: "sd-range" + (range === v ? " is-on" : ""), onClick: () => { range = v; shell.select("overview"); } }, label)));
  const body = h("div");
  host.append(card({ title: "Performance", action: rangeBar, body }));

  body.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let d: Digest;
  try { const r = await bvApi<{ digest: Digest; ses_configured: boolean }>(`/api/digest?range=${range}`); d = r.digest; sesOk = r.ses_configured; }
  catch (err: any) { body.innerHTML = ""; body.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  body.innerHTML = "";

  body.append(statRow([
    { k: "Revenue", v: fmtMoney(d.revenue, d.currency), tone: "ok", icon: "coins" },
    { k: "Paid orders", v: String(d.paid), icon: "receipt" },
    { k: "Avg order", v: fmtMoney(d.aov, d.currency), tone: "accent", icon: "chart" },
    { k: "New customers", v: String(d.new_customers), icon: "users" },
  ]));

  if (d.by_day.length > 1) body.append(h("div", { class: "sd-chart" }, sparkbars(d.by_day, d.currency)));

  const cols = h("div", { class: "sd-cols" });
  // secondary stats
  cols.append(card({ title: "Summary", body: h("table", { class: "bv-table sd-kv" }, h("tbody", null,
    kv("Orders (all states)", String(d.orders)),
    kv("Refunds", String(d.refunds)),
    d.biggest ? kv("Biggest order", `${fmtMoney(d.biggest.total, d.currency)}${d.biggest.customer ? ` · ${d.biggest.customer}` : ""}`) : kv("Biggest order", "—"),
  ))}));
  cols.append(card({ title: "Top products", body: d.top_products.length
    ? h("table", { class: "bv-table sd-kv" }, h("tbody", null, ...d.top_products.map((p) => kv(p.title, `${p.qty} sold`))))
    : h("div", { class: "bv-muted", style: { padding: "6px 2px" } }, "No itemised product data in this range.") }));
  body.append(cols);

  const sendBtn = h("button", { class: "primary", disabled: !sesOk, title: sesOk ? "" : "Email isn't configured", onClick: () => sendNow() }, iconEl("send", 16), "Send this digest now");
  body.append(h("div", { class: "sd-send" }, sendBtn,
    h("span", { class: "bv-muted" }, sesOk ? "Goes to all enabled recipients." : "Configure email to enable sending.")));
}

function sparkbars(byDay: { date: string; total: number }[], cur: string) {
  const max = Math.max(...byDay.map((d) => d.total), 1);
  const wrap = h("div", { class: "sd-bars" });
  for (const d of byDay) {
    const pctH = Math.max(4, Math.round((d.total / max) * 100));
    wrap.append(h("div", { class: "sd-bar", title: `${d.date}: ${fmtMoney(d.total, cur)}` },
      h("div", { class: "sd-bar-fill", style: { height: `${pctH}%` } }),
      h("div", { class: "sd-bar-label" }, d.date.slice(5))));
  }
  return wrap;
}

async function sendNow() {
  try {
    const r = await bvApi<{ sent: number; failed: number }>("/api/digest/send", { method: "POST", body: JSON.stringify({ range }) });
    flash(`Digest sent to ${r.sent} recipient${r.sent === 1 ? "" : "s"}${r.failed ? ` · ${r.failed} failed` : ""}`, r.failed ? "warning" : "success");
  } catch (err: any) { toast(err?.message || "Couldn't send", "error"); }
}

/* ---------------------------------------------------------------- Recipients */
async function renderRecipients(host: HTMLElement) {
  let data: { recipients: Recipient[]; ses_configured: boolean };
  try { data = await bvApi("/api/recipients"); sesOk = data.ses_configured; }
  catch (err: any) { host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }

  const table = data.recipients.length
    ? dataTable<Recipient>({
        columns: [
          { head: "Recipient", cell: (r) => h("div", null, h("strong", null, r.name || r.email), r.name ? h("div", { class: "bv-muted" }, r.email) : null) },
          { head: "Source", cell: (r) => pill(r.source, r.source === "merchant" ? "accent" : undefined) },
          { head: "Gets digest", cell: (r) => toggle(r) },
        ],
        rows: data.recipients,
        rowActions: (r) => r.source === "merchant" ? null : h("button", { class: "ghost sm", onClick: async () => { await bvApi(`/api/recipients/${r.id}`, { method: "DELETE" }); shell.select("recipients"); } }, iconEl("trash", 14)),
      })
    : emptyState({ icon: "users", title: "No recipients yet", text: "Add who should receive the digest." });

  const email = h("input", { type: "email", placeholder: "name@email.com" }) as HTMLInputElement;
  const name = h("input", { placeholder: "Name (optional)" }) as HTMLInputElement;
  const add = h("button", { class: "primary", onClick: async () => {
    if (!email.value.trim()) { toast("Enter an email", "warning"); return; }
    try { await bvApi("/api/recipients", { method: "POST", body: JSON.stringify({ email: email.value, name: name.value }) }); flash("Recipient added", "success"); shell.select("recipients"); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  } }, "Add recipient");

  host.append(
    card({ title: "Recipients", body: table }),
    card({ title: "Add recipient", body: h("div", { class: "sd-addrow" }, email, name, add) }),
  );
  if (!sesOk) host.append(h("div", { class: "sd-warn" }, iconEl("alert", 15), "Email sending isn't configured yet — sends will be disabled until it is."));
}

function toggle(r: Recipient) {
  const input = h("input", { type: "checkbox", checked: r.enabled }) as HTMLInputElement;
  input.addEventListener("change", async () => {
    try { await bvApi(`/api/recipients/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: input.checked }) }); }
    catch (err: any) { toast(err?.message || "error", "error"); input.checked = !input.checked; }
  });
  return h("label", { class: "sd-toggle" }, input);
}

/* ------------------------------------------------------------------ Schedule */
async function renderSchedule(host: HTMLElement) {
  let s: Settings;
  try { s = (await bvApi<{ settings: Settings }>("/api/settings")).settings; }
  catch (err: any) { host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }

  const freq = h("select", null, ...[["daily", "Every day"], ["weekly", "Every week"], ["off", "Off (manual only)"]].map(([v, l]) => h("option", { value: v, selected: s.frequency === v }, l))) as HTMLSelectElement;
  const time = h("input", { type: "time", value: s.time || "08:00" }) as HTMLInputElement;
  const rng = h("select", null, ...RANGES.map(([v, l]) => h("option", { value: v, selected: s.range === v }, l))) as HTMLSelectElement;

  const save = h("button", { class: "primary", onClick: async () => {
    try { await bvApi("/api/settings", { method: "POST", body: JSON.stringify({ frequency: freq.value, time: time.value, range: rng.value }) }); flash("Schedule saved", "success"); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  } }, "Save schedule");

  host.append(card({ title: "Schedule", body: h("div", null,
    h("div", { class: "sd-form" }, field("Frequency", freq), field("Time of day", time), field("What to include", rng)),
    h("div", { class: "sd-note" }, iconEl("clock", 15), "Scheduled auto-send runs on the digest worker. Until that's enabled, use “Send now” on the Overview tab — it delivers immediately."),
    h("div", { style: { marginTop: "12px" } }, save),
  )}));
}

/* ---------------------------------------------------------------------- Log */
async function renderLog(host: HTMLElement) {
  let log: LogRow[];
  try { log = (await bvApi<{ log: LogRow[] }>("/api/log")).log; }
  catch (err: any) { host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.append(card({ title: "Send log", body: log.length
    ? dataTable<LogRow>({
        columns: [
          { head: "Sent", cell: (r) => h("span", { class: "bv-muted" }, relTime(r.created_at)) },
          { head: "Digest", cell: (r) => h("div", null, h("strong", null, r.range_label), h("div", { class: "bv-muted" }, `${fmtMoney(Number(r.revenue), r.currency)} · ${r.orders} orders`)) },
          { head: "Recipients", cell: (r) => `${(r.message_ids || []).length} sent` },
          { head: "By", cell: (r) => h("span", { class: "bv-muted" }, r.sent_by_name || "—") },
        ],
        rows: log,
      })
    : emptyState({ icon: "inbox", title: "No digests sent yet", text: "Send one from the Overview tab to see it here." }) }));
}

/* -------------------------------------------------------------------- helpers */
function kv(k: string, v: string) { return h("tr", null, h("td", null, h("span", { class: "bv-muted" }, k)), h("td", { class: "num" }, v)); }
function field(label: string, el: HTMLElement) { return h("label", { class: "sd-field" }, h("span", { class: "bv-label" }, label), el); }
function fatal(msg?: string) {
  return h("div", { class: "bv-empty", style: { margin: "40px auto" } }, h("h3", null, "Sales Digest couldn't load"), h("p", null, msg || "Open this app from the Inkress dashboard."));
}
