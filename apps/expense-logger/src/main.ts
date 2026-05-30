import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

interface Summary {
  month_start: string;
  revenue: number;
  expenses: number;
  profit: number;
  currency: string;
  by_category: { category: string; currency: string; total: number }[];
}
interface Expense {
  id: number;
  category: string;
  amount: number;
  currency: string;
  note: string | null;
  spent_on: string;
}

const CATEGORIES = ["Rent", "Utilities", "Stock / Supplies", "Wages", "Marketing", "Transport", "Fees", "Other"];
const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let currency = "JMD";

(async () => {
  let session;
  try { session = await initBv(); }
  catch (err: any) { root.innerHTML = fatal("Expense Logger", err?.message); return; }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  currency = session.merchant.currency_code || "JMD";
  renderShell();
  await Promise.all([refreshSummary(), refreshList()]);
})();

function renderShell() {
  root.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div>
          <h1>Expense Logger</h1>
          <p class="bv-muted">${esc(merchantName)} · this month's profit &amp; loss</p>
        </div>
        <span class="bv-pill">by Bookerva</span>
      </header>

      <div id="summary" class="bv-grid bv-grid-3" style="margin-bottom:16px;">${statSkeleton(3)}</div>

      <div class="bv-card">
        <h2 style="margin-top:0;">Log an expense</h2>
        <form id="exp-form" class="bv-stack" style="max-width:560px;">
          <div class="bv-grid bv-grid-2">
            <div>
              <label class="bv-label">Category</label>
              <select id="f-cat">${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select>
            </div>
            <div>
              <label class="bv-label">Amount (${esc(currency)})</label>
              <input id="f-amount" type="number" step="0.01" placeholder="0.00" />
            </div>
          </div>
          <div class="bv-grid bv-grid-2">
            <div>
              <label class="bv-label">Date</label>
              <input id="f-date" type="date" value="${new Date().toISOString().slice(0, 10)}" />
            </div>
            <div>
              <label class="bv-label">Note (optional)</label>
              <input id="f-note" placeholder="e.g. May electricity" />
            </div>
          </div>
          <div class="bv-row"><button type="submit" class="primary">Add expense</button></div>
        </form>
      </div>

      <h2 class="bv-section-title">Recent expenses</h2>
      <div id="list" class="bv-card"><div class="bv-skeleton" style="width:70%;"></div></div>
    </div>`;
  document.getElementById("exp-form")!.addEventListener("submit", onAdd);
}

async function refreshSummary() {
  try {
    const s = await bvApi<Summary>("/api/summary");
    currency = s.currency || currency;
    const profitTone = s.profit >= 0 ? "success" : "destructive";
    document.getElementById("summary")!.innerHTML = `
      ${statCard("Revenue (paid)", money(s.revenue, s.currency))}
      ${statCard("Expenses", money(s.expenses, s.currency))}
      ${statCard("Profit", money(s.profit, s.currency), profitTone)}`;
  } catch (err: any) {
    document.getElementById("summary")!.innerHTML =
      `<div class="bv-card bv-empty">Couldn't load summary: ${esc(err?.message || "error")}</div>`;
  }
}

async function refreshList() {
  try {
    const { expenses } = await bvApi<{ expenses: Expense[] }>("/api/expenses");
    const el = document.getElementById("list")!;
    if (!expenses.length) {
      el.innerHTML = `<div class="bv-empty">No expenses logged yet. Add your first above.</div>`;
      return;
    }
    el.innerHTML = `
      <table class="bv-table">
        <thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Amount</th><th></th></tr></thead>
        <tbody>${expenses.map((e) => `
          <tr>
            <td class="bv-muted">${esc(e.spent_on)}</td>
            <td>${esc(e.category)}</td>
            <td class="bv-muted">${esc(e.note || "—")}</td>
            <td>${money(e.amount, e.currency)}</td>
            <td style="text-align:right;"><button data-id="${e.id}" class="destructive">Delete</button></td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-id]").forEach((b) =>
      b.addEventListener("click", () => onDelete(b.dataset.id!)));
  } catch (err: any) {
    document.getElementById("list")!.innerHTML =
      `<div class="bv-empty">Couldn't load expenses: ${esc(err?.message || "error")}</div>`;
  }
}

async function onAdd(e: Event) {
  e.preventDefault();
  const body = {
    category: (document.getElementById("f-cat") as HTMLSelectElement).value,
    amount: (document.getElementById("f-amount") as HTMLInputElement).value,
    spent_on: (document.getElementById("f-date") as HTMLInputElement).value,
    note: (document.getElementById("f-note") as HTMLInputElement).value || null,
    currency,
  };
  try {
    await bvApi("/api/expenses", { method: "POST", body: JSON.stringify(body) });
    toast("Expense added", "success");
    (document.getElementById("exp-form") as HTMLFormElement).reset();
    (document.getElementById("f-date") as HTMLInputElement).value = new Date().toISOString().slice(0, 10);
    await Promise.all([refreshSummary(), refreshList()]);
  } catch (err: any) {
    toast(err?.message || "Couldn't add expense", "error");
  }
}

async function onDelete(id: string) {
  try {
    await bvApi(`/api/expenses/${id}`, { method: "DELETE" });
    toast("Deleted", "success");
    await Promise.all([refreshSummary(), refreshList()]);
  } catch (err: any) {
    toast(err?.message || "Delete failed", "error");
  }
}

function statCard(label: string, value: string, tone = "") {
  const color = tone === "destructive" ? "hsl(var(--destructive))" : tone === "success" ? "hsl(var(--success))" : "inherit";
  return `<div class="bv-card"><div class="bv-label">${esc(label)}</div>
    <div style="font-size:24px;font-weight:600;color:${color};">${esc(value)}</div></div>`;
}
function statSkeleton(n: number) {
  return Array.from({ length: n }).map(() =>
    `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div>
     <div class="bv-skeleton" style="height:24px;width:60%;margin-top:6px;"></div></div>`).join("");
}
function money(n: number, c: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n || 0); }
  catch { return `${(n || 0).toFixed(2)} ${c}`; }
}
function fatal(title: string, msg?: string) {
  return `<div class="bv-shell"><div class="bv-card" style="text-align:center;">
    <h1>${esc(title)} couldn't load</h1><p class="bv-muted">${esc(msg || "Unknown error")}</p></div></div>`;
}
function esc(s: string) {
  return String(s).replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;");
}
