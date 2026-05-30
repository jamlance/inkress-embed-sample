import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, statRow, dataTable, card, flash,
  fmtMoney, relTime, pill, emptyState, h, iconEl,
} from "./bv-init";

interface CurStat { currency: string; revenue: number; paid: number; orders: number; refunds: number; aov: number; }
interface Summary { range: string; currencies: CurStat[]; trend: Record<string, any>[]; currency_codes: string[]; }
interface Balance { currency: string; available: number; pending: number; }
interface Order { id: number; ref: string; total: number; currency: string; status: string; customer: string | null; created_at: string | null; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let baseCurrency = "JMD";
let range = "30d";
let orderCur = "";
let shell: ReturnType<typeof mountShell>;

const RANGES: [string, string][] = [["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"]];
const ACCENTS = ["var(--accent)", "oklch(0.6 0.14 155)", "oklch(0.62 0.14 70)", "oklch(0.55 0.2 25)", "oklch(0.55 0.16 295)"];

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
  baseCurrency = session.merchant.currency_code || "JMD";

  shell = mountShell({
    brandIcon: "coins",
    title: "Currency Dashboard",
    subtitle: `${merchantName} · money across every currency`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "overview", label: "Overview", icon: "pie", render: renderOverview },
      { id: "orders", label: "Orders", icon: "list", render: renderOrders },
    ],
  });
})();

/* ------------------------------------------------------------------ Overview */
async function renderOverview(host: HTMLElement) {
  const rangeBar = h("div", { class: "cd-ranges" },
    ...RANGES.map(([v, l]) => h("button", { class: "cd-range" + (range === v ? " is-on" : ""), onClick: () => { range = v; shell.select("overview"); } }, l)));

  const balHost = h("div");
  const sumHost = h("div");
  host.append(card({ title: "Wallet", body: balHost }), card({ title: "Sales by currency", action: rangeBar, body: sumHost }));

  // balances
  balHost.append(h("div", { class: "bv-muted", style: { padding: "8px 2px" } }, "Loading…"));
  bvApi<{ balances: Balance[]; available: boolean }>("/api/balances").then((b) => {
    balHost.innerHTML = "";
    if (!b.available || !b.balances.length) { balHost.append(h("div", { class: "bv-muted", style: { padding: "6px 2px" } }, "Wallet balance isn't available for this account.")); return; }
    const grid = h("div", { class: "cd-balances" });
    for (const bal of b.balances) {
      grid.append(h("div", { class: "cd-balance" },
        h("div", { class: "cd-cur" }, bal.currency),
        h("div", { class: "cd-amt" }, fmtMoney(bal.available, bal.currency)),
        h("div", { class: "bv-muted" }, `${fmtMoney(bal.pending, bal.currency)} pending`)));
    }
    balHost.append(grid);
  }).catch(() => { balHost.innerHTML = ""; balHost.append(h("div", { class: "bv-muted" }, "Wallet balance unavailable.")); });

  // summary
  sumHost.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let s: Summary;
  try { s = await bvApi(`/api/summary?range=${range}`); }
  catch (err: any) { sumHost.innerHTML = ""; sumHost.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  sumHost.innerHTML = "";
  if (!s.currencies.length) { sumHost.append(emptyState({ icon: "coins", title: "No sales in this range", text: "Pick a wider range or take some orders." })); return; }

  // headline (top currency)
  const top = s.currencies[0]!;
  sumHost.append(statRow([
    { k: "Currencies", v: String(s.currencies.length), icon: "coins" },
    { k: `${top.currency} revenue`, v: fmtMoney(top.revenue, top.currency), tone: "ok", icon: "chart" },
    { k: "Paid orders", v: String(s.currencies.reduce((a, c) => a + c.paid, 0)), icon: "receipt" },
    { k: "Refunds", v: String(s.currencies.reduce((a, c) => a + c.refunds, 0)), tone: s.currencies.some((c) => c.refunds) ? "bad" : undefined, icon: "wallet" },
  ]));

  if (s.trend.length > 1) sumHost.append(h("div", { class: "cd-chart" }, trendChart(s.trend, s.currency_codes)));

  sumHost.append(dataTable<CurStat>({
    columns: [
      { head: "Currency", cell: (c) => h("strong", null, c.currency) },
      { head: "Revenue", num: true, cell: (c) => fmtMoney(c.revenue, c.currency) },
      { head: "Paid", num: true, cell: (c) => String(c.paid) },
      { head: "Avg order", num: true, cell: (c) => fmtMoney(c.aov, c.currency) },
      { head: "Refunds", num: true, cell: (c) => c.refunds ? pill(String(c.refunds), "bad") : "—" },
    ],
    rows: s.currencies,
    onRowClick: (c) => { orderCur = c.currency; shell.select("orders"); },
  }));
}

function trendChart(trend: Record<string, any>[], codes: string[]) {
  const max = Math.max(...trend.map((d) => codes.reduce((a, c) => a + (d[c] || 0), 0)), 1);
  const wrap = h("div", { class: "cd-bars" });
  for (const d of trend) {
    const stack = h("div", { class: "cd-bar-stack" });
    codes.forEach((c, i) => {
      const v = d[c] || 0; if (!v) return;
      stack.append(h("div", { class: "cd-seg", title: `${d.date} · ${c}: ${fmtMoney(v, c)}`, style: { height: `${Math.round((v / max) * 100)}%`, background: ACCENTS[i % ACCENTS.length] } }));
    });
    wrap.append(h("div", { class: "cd-bar" }, stack, h("div", { class: "cd-bar-label" }, String(d.date).slice(5))));
  }
  const legend = h("div", { class: "cd-legend" }, ...codes.map((c, i) => h("span", { class: "cd-leg" }, h("i", { style: { background: ACCENTS[i % ACCENTS.length] } }), c)));
  return h("div", null, wrap, codes.length > 1 ? legend : null);
}

/* -------------------------------------------------------------------- Orders */
async function renderOrders(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { orders: Order[] };
  let codes: string[] = [];
  try {
    [data] = await Promise.all([bvApi<{ orders: Order[] }>(`/api/orders${orderCur ? `?currency=${orderCur}` : ""}`)]);
    codes = [...new Set((await bvApi<{ orders: Order[] }>("/api/orders")).orders.map((o) => o.currency))];
  } catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load orders", text: err?.message })); return; }
  host.innerHTML = "";

  const filters = h("div", { class: "cd-filters" },
    h("button", { class: "cd-filter" + (orderCur === "" ? " is-on" : ""), onClick: () => { orderCur = ""; shell.select("orders"); } }, "All"),
    ...codes.map((c) => h("button", { class: "cd-filter" + (orderCur === c ? " is-on" : ""), onClick: () => { orderCur = c; shell.select("orders"); } }, c)));

  host.append(card({
    title: "Orders", action: filters,
    body: data.orders.length ? dataTable<Order>({
      columns: [
        { head: "Order", cell: (o) => h("div", null, h("strong", null, `#${o.ref}`), o.customer ? h("div", { class: "bv-muted" }, o.customer) : null) },
        { head: "Amount", num: true, cell: (o) => h("span", null, fmtMoney(o.total, o.currency), h("span", { class: "cd-tag" }, o.currency)) },
        { head: "Status", cell: (o) => pill(o.status, o.status === "paid" || o.status === "completed" ? "ok" : o.status === "refunded" || o.status === "cancelled" ? "bad" : undefined) },
        { head: "When", cell: (o) => h("span", { class: "bv-muted" }, o.created_at ? relTime(o.created_at) : "—") },
      ],
      rows: data.orders,
    }) : emptyState({ icon: "receipt", title: "No orders", text: "No orders in this currency yet." }),
  }));
}

function fatal(msg?: string) {
  return h("div", { class: "bv-empty", style: { margin: "40px auto" } }, h("h3", null, "Currency Dashboard couldn't load"), h("p", null, msg || "Open this app from the Inkress dashboard."));
}
