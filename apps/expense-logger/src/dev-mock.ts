/** DEV-ONLY preview harness — tree-shaken from prod. */
import type { BvSession } from "./bv-init";

const CATS = ["Supplies", "Rent", "Salaries", "Utilities", "Marketing", "Equipment", "Inventory", "Transport", "Fees", "Other"];
const vendors = ["Sangsters", "JPS", "NWC", "Facebook Ads", "Hi-Lo", "Courier Co", "Beauty Depot"];
const EXP: any[] = [];
let id = 50;
for (let i = 0; i < 22; i++) {
  const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * 80));
  EXP.push({ id: id--, spent_on: d.toISOString().slice(0, 10), amount: Math.round(800 + Math.random() * 22000), currency: "JMD",
    category: CATS[Math.floor(Math.random() * 6)], vendor: vendors[Math.floor(Math.random() * vendors.length)], note: null,
    created_by: { id: 90, name: "Front Desk" }, created_at: d.toISOString() });
}

function overview(range: string) {
  const days = range === "30d" ? 30 : range === "365d" ? 365 : 90;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = EXP.filter((e) => e.spent_on >= since);
  const total = Math.round(rows.reduce((s, e) => s + e.amount, 0));
  const byCat = new Map<string, number>(); for (const e of rows) byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount);
  const revenue = 317135;
  return { range, currency: "JMD", revenue, revenue_ok: true, expenses_total: total, profit: revenue - total, expense_count: rows.length,
    by_category: [...byCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    recent: rows.slice(0, 6) };
}

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url, location.origin);
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 90));
    const idm = u.pathname.match(/\/api\/expenses\/(\d+)/);

    if (u.pathname === "/api/overview") return json(overview(u.searchParams.get("range") || "30d"));
    if (u.pathname === "/api/expenses" && method === "GET") {
      const cat = u.searchParams.get("category");
      let rows = EXP.slice().sort((a, b) => b.spent_on.localeCompare(a.spent_on));
      if (cat) rows = rows.filter((e) => e.category === cat);
      return json({ expenses: rows, categories: CATS });
    }
    if (u.pathname === "/api/expenses" && method === "POST") { const e = { id: ++id + 100, ...body, created_by: { id: 90, name: "Front Desk" }, created_at: new Date().toISOString() }; EXP.unshift(e); return json({ expense: e }, 201); }
    if (idm && method === "PATCH") { const e = EXP.find((x) => x.id === Number(idm[1])); Object.assign(e, body); return json({ expense: e }); }
    if (idm && method === "DELETE") { const i = EXP.findIndex((x) => x.id === Number(idm[1])); if (i >= 0) EXP.splice(i, 1); return json({ ok: true }); }
    return new Response("{}", { status: 404 });
  };
}

export function mockSession(): BvSession {
  return {
    inkress: { notify: ({ message }: any) => console.log("[toast]", message) } as any,
    merchant: { id: 183, username: "bookerva-jackjack", name: "Jack Jack Barbershop", currency_code: "JMD", email: "jack@example.com", logo: null },
    user: { id: 90, name: "Front Desk", email: "desk@jackjack.com" },
    scopes: ["orders:read"],
  };
}
