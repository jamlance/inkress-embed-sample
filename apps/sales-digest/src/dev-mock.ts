/** DEV-ONLY preview harness — tree-shaken from prod (guarded by import.meta.env.DEV). */
import type { BvSession } from "./bv-init";

const RECIPIENTS: any[] = [
  { id: 1, email: "jack@example.com", name: "Jack Jack", enabled: true, source: "merchant" },
  { id: 2, email: "manager@example.com", name: "Keisha (manager)", enabled: true, source: "manual" },
  { id: 3, email: "accountant@example.com", name: null, enabled: false, source: "manual" },
];
let RID = 3;
let SETTINGS: any = { frequency: "daily", time: "08:00", range: "yesterday", currency: null };
const LOG: any[] = [
  { id: 1, range_label: "Yesterday's", currency: "JMD", revenue: "48500", orders: 9, message_ids: [{ email: "jack@example.com", id: "m1" }, { email: "manager@example.com", id: "m2" }], recipients: ["jack@example.com", "manager@example.com"], sent_by_name: "Front Desk", created_at: new Date(Date.now() - 9e7).toISOString() },
];

function digestFor(range: string) {
  const base = range === "today" ? 0.4 : range === "yesterday" ? 1 : range === "7d" ? 6.2 : 26;
  const revenue = Math.round(48500 * base);
  const paid = Math.round(9 * base);
  const days = range === "7d" ? 7 : range === "30d" ? 14 : 1;
  const by_day = Array.from({ length: days }).map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (days - 1 - i));
    return { date: d.toISOString().slice(0, 10), total: Math.round(4000 + Math.random() * 9000) };
  });
  return {
    range, currency: "JMD", revenue, orders: paid + 2, paid,
    aov: paid ? Math.round(revenue / paid) : 0, refunds: range === "30d" ? 2 : 0,
    new_customers: Math.max(1, Math.round(paid / 3)),
    biggest: { ref: "ORD-2369", total: 24000, customer: "Aaliyah Wright" },
    by_day: range === "today" || range === "yesterday" ? [] : by_day,
    top_products: [{ title: "Afro Fade", qty: 14 }, { title: "Colour Treatment", qty: 6 }, { title: "Hot Towel Shave", qty: 5 }],
  };
}

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url, location.origin);
    const path = u.pathname;
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 90));

    if (path === "/api/digest") return json({ digest: digestFor(u.searchParams.get("range") || "7d"), ses_configured: true });
    if (path === "/api/recipients" && method === "GET") return json({ recipients: RECIPIENTS, ses_configured: true });
    if (path === "/api/recipients" && method === "POST") { RECIPIENTS.push({ id: ++RID, email: body.email, name: body.name || null, enabled: true, source: "manual" }); return json({ recipients: RECIPIENTS }, 201); }
    if (path.startsWith("/api/recipients/") && method === "PATCH") { const r = RECIPIENTS.find((x) => String(x.id) === path.split("/").pop()); if (r) r.enabled = body.enabled; return json({ ok: true }); }
    if (path.startsWith("/api/recipients/") && method === "DELETE") { const i = RECIPIENTS.findIndex((x) => String(x.id) === path.split("/").pop()); if (i >= 0) RECIPIENTS.splice(i, 1); return json({ ok: true }); }
    if (path === "/api/settings" && method === "GET") return json({ settings: SETTINGS });
    if (path === "/api/settings" && method === "POST") { SETTINGS = { ...SETTINGS, ...body }; return json({ settings: SETTINGS }); }
    if (path === "/api/digest/send") { const d = digestFor(body.range || "yesterday"); LOG.unshift({ id: LOG.length + 1, range_label: "Yesterday's", currency: "JMD", revenue: String(d.revenue), orders: d.paid, message_ids: RECIPIENTS.filter((r) => r.enabled).map((r) => ({ email: r.email, id: "m" + Math.random() })), recipients: RECIPIENTS.filter((r) => r.enabled).map((r) => r.email), sent_by_name: "Front Desk", created_at: new Date().toISOString() }); return json({ sent: RECIPIENTS.filter((r) => r.enabled).length, failed: 0, digest: d }); }
    if (path === "/api/log") return json({ log: LOG });
    return new Response("{}", { status: 404 });
  };
}

export function mockSession(): BvSession {
  return {
    inkress: { notify: ({ message }: any) => console.log("[toast]", message) } as any,
    merchant: { id: 183, username: "bookerva-jackjack", name: "Jack Jack Barbershop", currency_code: "JMD", email: "jack@example.com", logo: null },
    user: { id: 90, name: "Front Desk", email: "desk@jackjack.com" },
    scopes: ["orders:read", "merchant_profile:read"],
  };
}
