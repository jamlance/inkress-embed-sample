/** DEV-ONLY preview harness — tree-shaken from prod. */
import type { BvSession } from "./bv-init";

const ORDERS: any[] = [];
const curs = ["JMD", "USD", "KYD"];
const titles = ["Afro Fade", "Colour Treatment", "Hot Towel Shave", "Wash & Style"];
let id = 2400;
for (let i = 0; i < 60; i++) {
  const c = curs[i % 3 === 0 ? 0 : i % 5 === 0 ? 1 : i % 7 === 0 ? 2 : 0];
  const paid = Math.random() > 0.2;
  ORDERS.push({
    id: id++, reference_id: "ORD-" + (id), title: titles[i % 4],
    total: c === "USD" ? Math.round(20 + Math.random() * 120) : c === "KYD" ? Math.round(15 + Math.random() * 90) : Math.round(2000 + Math.random() * 12000),
    currency: { code: c }, status: paid ? 3 : i % 11 === 0 ? 11 : 1,
    customer: { first_name: "Customer", last_name: String(i) },
    inserted_at: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
  });
}

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const u = new URL(url, location.origin);
    const json = (d: any) => new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 80));

    if (u.pathname === "/api/balances") return json({ available: true, balances: [
      { currency: "JMD", available: 184500, pending: 12000 },
      { currency: "USD", available: 920.5, pending: 140 },
      { currency: "KYD", available: 310, pending: 0 },
    ] });
    if (u.pathname === "/api/summary") {
      const days = u.searchParams.get("range") === "7d" ? 7 : u.searchParams.get("range") === "90d" ? 90 : 30;
      const since = Date.now() - days * 86400000;
      const inR = ORDERS.filter((o) => new Date(o.inserted_at).getTime() >= since);
      const byCur = new Map<string, any>(); const byDay = new Map<string, any>();
      for (const o of inR) {
        const c = o.currency.code; const m = byCur.get(c) || { currency: c, revenue: 0, paid: 0, orders: 0, refunds: 0 };
        m.orders++; if (o.status === 11) m.refunds++;
        if (o.status === 3) { m.paid++; m.revenue = Math.round((m.revenue + o.total) * 100) / 100; const d = o.inserted_at.slice(0, 10); const day = byDay.get(d) || {}; day[c] = Math.round((day[c] || 0) + o.total); byDay.set(d, day); }
        byCur.set(c, m);
      }
      const currencies = [...byCur.values()].map((m) => ({ ...m, aov: m.paid ? Math.round(m.revenue / m.paid) : 0 })).sort((a, b) => b.revenue - a.revenue);
      const trend = [...byDay.entries()].sort().map(([date, vals]) => ({ date, ...vals }));
      return json({ range: u.searchParams.get("range") || "30d", currencies, trend, currency_codes: currencies.map((c) => c.currency) });
    }
    if (u.pathname === "/api/orders") {
      const cur = u.searchParams.get("currency");
      let os = ORDERS.map((o) => ({ id: o.id, ref: o.reference_id, total: o.total, currency: o.currency.code, status: o.status === 3 ? "paid" : o.status === 11 ? "refunded" : "pending", customer: "Customer " + o.id, created_at: o.inserted_at }));
      if (cur) os = os.filter((o) => o.currency === cur);
      return json({ orders: os.slice(0, 100) });
    }
    return new Response("{}", { status: 404 });
  };
}

export function mockSession(): BvSession {
  return {
    inkress: { notify: ({ message }: any) => console.log("[toast]", message) } as any,
    merchant: { id: 183, username: "bookerva-jackjack", name: "Jack Jack Barbershop", currency_code: "JMD", email: "jack@example.com", logo: null },
    user: { id: 90, name: "Front Desk", email: "desk@jackjack.com" },
    scopes: ["orders:read", "wallet:read"],
  };
}
