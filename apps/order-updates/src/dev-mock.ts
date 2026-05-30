/** DEV-ONLY preview harness — tree-shaken from prod. */
import type { BvSession } from "./bv-init";

const EVENTS = ["paid", "confirmed", "prepared", "shipped", "delivered", "completed", "refunded", "cancelled"];
const ORDERS = [
  { id: 2371, ref: "ORD-2371", status: "paid", total: 7500, currency: "JMD", customer: { name: "Maria Brown", email: "maria@example.com" }, created_at: new Date(Date.now() - 36e5).toISOString() },
  { id: 2370, ref: "ORD-2370", status: "shipped", total: 3500, currency: "JMD", customer: { name: "Devon Clarke", email: "devon@example.com" }, created_at: new Date(Date.now() - 72e5).toISOString() },
  { id: 2369, ref: "ORD-2369", status: "completed", total: 24000, currency: "JMD", customer: { name: "Aaliyah Wright", email: null }, created_at: new Date(Date.now() - 9e6).toISOString() },
  { id: 2368, ref: "ORD-2368", status: "refunded", total: 1800, currency: "JMD", customer: { name: "Kemar Lewis", email: "kemar@example.com" }, created_at: new Date(Date.now() - 1.2e7).toISOString() },
];
let TEMPLATES: Record<string, any> = {
  paid: { enabled: true, subject: "We got your payment — {{shop}}", body: "Thanks {{name}}! Order {{ref}} for {{total}} is confirmed." },
  shipped: { enabled: true, subject: "On the way — {{shop}}", body: "Good news {{name}} — order {{ref}} has shipped." },
  delivered: { enabled: false, subject: "Delivered — {{shop}}", body: "Hi {{name}}, order {{ref}} was delivered." },
  refunded: { enabled: false, subject: "Refund processed — {{shop}}", body: "Hi {{name}}, we refunded {{ref}} ({{total}})." },
  cancelled: { enabled: false, subject: "Order cancelled — {{shop}}", body: "Hi {{name}}, order {{ref}} was cancelled." },
};
const LOG: any[] = [{ id: 1, order_ref: "ORD-2360", event: "shipped", email: "x@example.com", sent_by_name: "Front Desk", created_at: new Date(Date.now() - 9e7).toISOString() }];

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url, location.origin);
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 80));
    const sm = u.pathname.match(/\/api\/orders\/(\d+)\/send/);

    if (u.pathname === "/api/orders") return json({ orders: ORDERS, ses_configured: true });
    if (u.pathname === "/api/templates" && method === "GET") return json({ templates: TEMPLATES, events: EVENTS, ses_configured: true });
    if (u.pathname === "/api/templates" && method === "POST") { TEMPLATES = body.templates; return json({ templates: TEMPLATES }); }
    if (sm) { const o = ORDERS.find((x) => x.id === Number(sm[1])); LOG.unshift({ id: LOG.length + 1, order_ref: o?.ref, event: body.event, email: o?.customer?.email, sent_by_name: "Front Desk", created_at: new Date().toISOString() }); return json({ ok: true }); }
    if (u.pathname === "/api/log") return json({ log: LOG });
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
