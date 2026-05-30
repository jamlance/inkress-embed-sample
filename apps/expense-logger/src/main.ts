import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, statRow, dataTable, card, openModal, flash,
  fmtMoney, fmtDate, pill, emptyState, h, iconEl,
} from "./bv-init";

interface Expense { id: number; spent_on: string; amount: number; currency: string; category: string; vendor: string | null; note: string | null; created_by: { id: number; name: string } | null; created_at: string; }
interface Overview { range: string; currency: string; revenue: number; revenue_ok: boolean; expenses_total: number; profit: number; expense_count: number; by_category: { category: string; amount: number }[]; recent: Expense[]; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let currency = "JMD";
let range = "30d";
let expFilter = "";
let activeTab = "overview";
let categories: string[] = ["Supplies", "Rent", "Salaries", "Utilities", "Marketing", "Equipment", "Inventory", "Transport", "Fees", "Other"];
let shell: ReturnType<typeof mountShell>;

const RANGES: [string, string][] = [["30d", "30 days"], ["90d", "90 days"], ["365d", "12 months"]];

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
    brandIcon: "wallet",
    title: "Expense Logger",
    subtitle: `${merchantName} · track spend, see real profit`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "overview", label: "Overview", icon: "pie", render: renderOverview },
      { id: "expenses", label: "Expenses", icon: "list", render: renderExpenses },
    ],
  });
})();

/* ------------------------------------------------------------------ Overview */
async function renderOverview(host: HTMLElement) {
  activeTab = "overview";
  const rangeBar = h("div", { class: "ex-ranges" },
    ...RANGES.map(([v, l]) => h("button", { class: "ex-range" + (range === v ? " is-on" : ""), onClick: () => { range = v; shell.select("overview"); } }, l)));
  const addBtn = h("button", { class: "primary", onClick: () => openExpense(null) }, iconEl("plus", 16), "Add expense");

  host.append(h("div", { class: "ex-top" }, h("h2", null, "Profit & loss"), h("div", { class: "ex-top-actions" }, rangeBar, addBtn)));

  const body = h("div");
  host.append(body);
  body.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let o: Overview;
  try { o = await bvApi(`/api/overview?range=${range}`); }
  catch (err: any) { body.innerHTML = ""; body.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  body.innerHTML = "";

  body.append(statRow([
    { k: "Revenue (Inkress)", v: o.revenue_ok ? fmtMoney(o.revenue, o.currency) : "—", tone: "ok", icon: "coins" },
    { k: "Expenses", v: fmtMoney(o.expenses_total, o.currency), tone: "bad", icon: "receipt" },
    { k: "Profit", v: fmtMoney(o.profit, o.currency), tone: o.profit >= 0 ? "accent" : "bad", icon: "chart" },
    { k: "Logged", v: String(o.expense_count), icon: "edit" },
  ]));

  const cols = h("div", { class: "ex-cols" });
  cols.append(card({ title: "By category", body: o.by_category.length ? catBars(o.by_category, o.currency) : h("div", { class: "bv-muted", style: { padding: "6px 2px" } }, "No expenses in this range.") }));
  cols.append(card({
    title: "Recent expenses",
    action: o.recent.length ? h("button", { class: "ghost sm", onClick: () => shell.select("expenses") }, "View all") : undefined,
    body: o.recent.length ? h("table", { class: "bv-table" }, h("tbody", null, ...o.recent.map((e) =>
      h("tr", { onClick: () => openExpense(e), style: { cursor: "pointer" } },
        h("td", null, h("strong", null, e.category), h("div", { class: "bv-muted" }, `${fmtDate(e.spent_on)}${e.vendor ? ` · ${e.vendor}` : ""}`)),
        h("td", { class: "num" }, fmtMoney(e.amount, e.currency))))))
      : emptyState({ icon: "wallet", title: "No expenses yet", text: "Log your first expense to see profit." }),
  }));
  body.append(cols);
  if (!o.revenue_ok) body.append(h("div", { class: "ex-note bv-muted" }, iconEl("alert", 14), "Couldn't read Inkress revenue — profit excludes sales for now."));
}

function catBars(byCat: { category: string; amount: number }[], cur: string) {
  const max = Math.max(...byCat.map((c) => c.amount), 1);
  const wrap = h("div", { class: "ex-cats" });
  for (const c of byCat) {
    wrap.append(h("div", { class: "ex-cat" },
      h("div", { class: "ex-cat-head" }, h("span", null, c.category), h("b", null, fmtMoney(c.amount, cur))),
      h("div", { class: "ex-cat-track" }, h("div", { class: "ex-cat-fill", style: { width: `${Math.round((c.amount / max) * 100)}%` } }))));
  }
  return wrap;
}

/* ------------------------------------------------------------------ Expenses */
async function renderExpenses(host: HTMLElement) {
  activeTab = "expenses";
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { expenses: Expense[]; categories: string[] };
  try { data = await bvApi(`/api/expenses?range=365d${expFilter ? `&category=${encodeURIComponent(expFilter)}` : ""}`); categories = data.categories; }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";

  const cats = [...new Set(data.expenses.map((e) => e.category))];
  const filters = h("div", { class: "ex-filters" },
    h("button", { class: "ex-filter" + (expFilter === "" ? " is-on" : ""), onClick: () => { expFilter = ""; shell.select("expenses"); } }, "All"),
    ...cats.map((c) => h("button", { class: "ex-filter" + (expFilter === c ? " is-on" : ""), onClick: () => { expFilter = c; shell.select("expenses"); } }, c)));
  const addBtn = h("button", { class: "primary", onClick: () => openExpense(null) }, iconEl("plus", 15), "Add");

  host.append(card({
    title: "Expenses", action: h("div", { class: "ex-top-actions" }, filters, addBtn),
    body: data.expenses.length ? dataTable<Expense>({
      columns: [
        { head: "Date", cell: (e) => fmtDate(e.spent_on) },
        { head: "Category", cell: (e) => pill(e.category) },
        { head: "Vendor", cell: (e) => h("span", { class: "bv-muted" }, e.vendor || "—") },
        { head: "Amount", num: true, cell: (e) => fmtMoney(e.amount, e.currency) },
      ],
      rows: data.expenses,
      onRowClick: (e) => openExpense(e),
    }) : emptyState({ icon: "wallet", title: "No expenses logged", text: "Add expenses to track your spend and profit." }),
  }));
}

function openExpense(e: Expense | null) {
  const today = new Date().toISOString().slice(0, 10);
  const date = h("input", { type: "date", value: e?.spent_on?.slice(0, 10) || today }) as HTMLInputElement;
  const amount = h("input", { type: "number", min: "0", step: "0.01", value: e ? String(e.amount) : "", placeholder: "0.00" }) as HTMLInputElement;
  const category = h("select", null, ...categories.map((c) => h("option", { value: c, selected: e?.category === c }, c))) as HTMLSelectElement;
  const vendor = h("input", { value: e?.vendor || "", placeholder: "Who you paid (optional)" }) as HTMLInputElement;
  const note = h("input", { value: e?.note || "", placeholder: "Note (optional)" }) as HTMLInputElement;

  const body = h("div", { class: "ex-form" },
    h("div", { class: "ex-form-grid" }, field("Date", date), field("Amount", amount), field("Category", category), field("Vendor", vendor)),
    field("Note", note));

  const save = async () => {
    const amt = Number(amount.value);
    if (!(amt > 0)) { toast("Enter an amount", "warning"); return; }
    const payload = { spent_on: date.value, amount: amt, category: category.value, vendor: vendor.value || null, note: note.value || null, currency };
    try {
      if (e) await bvApi(`/api/expenses/${e.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await bvApi("/api/expenses", { method: "POST", body: JSON.stringify(payload) });
      flash(e ? "Expense updated" : "Expense added", "success");
      shell.select(activeTab);
    } catch (err: any) { toast(err?.message || "error", "error"); }
  };

  const actions: { label: string; primary?: boolean; danger?: boolean; onClick?: () => void | boolean }[] = [
    { label: e ? "Save" : "Add expense", primary: true, onClick: () => { void save(); } },
  ];
  if (e) actions.unshift({ label: "Delete", danger: true, onClick: () => { void (async () => { try { await bvApi(`/api/expenses/${e.id}`, { method: "DELETE" }); flash("Deleted", "info"); shell.select("expenses"); } catch (err: any) { toast(err?.message || "error", "error"); } })(); } });
  openModal({ title: e ? "Edit expense" : "Add expense", body, actions });
}

/* -------------------------------------------------------------------- helpers */
function field(label: string, el: HTMLElement) { return h("label", { class: "ex-field" }, h("span", { class: "bv-label" }, label), el); }
function fatal(msg?: string) {
  return h("div", { class: "bv-empty", style: { margin: "40px auto" } }, h("h3", null, "Expense Logger couldn't load"), h("p", null, msg || "Open this app from the Inkress dashboard."));
}
