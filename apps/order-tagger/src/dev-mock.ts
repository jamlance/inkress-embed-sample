/** DEV-ONLY preview harness — tree-shaken from prod (guarded by import.meta.env.DEV). */
import type { BvSession } from "./bv-init";

let RULES: any[] = [
  { id: 1, label: "VIP", min_total: "10000", status_is: null, currency_is: null, repeat_customer: false },
  { id: 2, label: "wholesale", min_total: "20000", status_is: null, currency_is: "JMD", repeat_customer: false },
];
let RID = 2;

const ORDERS: any[] = [
  { id: 2371, ref: "ORD-2371", total: 12500, currency: "JMD", status: "paid", title: "Phone order",
    customer: { name: "Maria Brown", email: "maria@example.com", phone: "8765550133", id: 11 },
    created_at: new Date(Date.now() - 36e5).toISOString(), tags: ["VIP"], tag_log: [{ label: "VIP", action: "auto", by: "System", at: new Date(Date.now() - 35e5).toISOString() }],
    inkress_url: "#", lines: [{ title: "Afro Fade", qty: 1, price: 5000 }, { title: "Colour Treatment", qty: 1, price: 7500 }] },
  { id: 2370, ref: "ORD-2370", total: 3500, currency: "JMD", status: "paid", title: "Counter sale",
    customer: { name: "Devon Clarke", email: "devon@example.com", phone: null, id: 12 },
    created_at: new Date(Date.now() - 72e5).toISOString(), tags: [], tag_log: [], inkress_url: "#",
    lines: [{ title: "Hot Towel Shave", qty: 1, price: 3500 }] },
  { id: 2369, ref: "ORD-2369", total: 24000, currency: "JMD", status: "completed", title: "Bulk order",
    customer: { name: "Aaliyah Wright", email: "aaliyah@example.com", phone: null, id: 13 },
    created_at: new Date(Date.now() - 9e6).toISOString(), tags: ["wholesale", "follow-up"], tag_log: [
      { label: "wholesale", action: "add", by: "Keisha", at: new Date(Date.now() - 8e6).toISOString() },
      { label: "follow-up", action: "add", by: "Front Desk", at: new Date(Date.now() - 7e6).toISOString() }],
    inkress_url: "#", lines: [{ title: "Colour Treatment", qty: 3, price: 8000 }] },
  { id: 2368, ref: "ORD-2368", total: 1800, currency: "JMD", status: "pending",
    customer: { name: "Maria Brown", email: "maria@example.com", phone: "8765550133", id: 11 },
    created_at: new Date(Date.now() - 1.2e7).toISOString(), tags: [], tag_log: [], inkress_url: "#",
    lines: [{ title: "Line-up & Edge", qty: 1, price: 1800 }] },
];

function matching(o: any) {
  const counts = new Map<string, number>();
  for (const x of ORDERS) if (x.customer?.email) counts.set(x.customer.email, (counts.get(x.customer.email) || 0) + 1);
  const repeat = new Set([...counts].filter(([, n]) => n > 1).map(([e]) => e));
  return RULES.filter((r) => {
    if (r.min_total != null && o.total < Number(r.min_total)) return false;
    if (r.status_is && o.status !== r.status_is) return false;
    if (r.currency_is && o.currency.toUpperCase() !== r.currency_is.toUpperCase()) return false;
    if (r.repeat_customer && !(o.customer?.email && repeat.has(o.customer.email))) return false;
    return true;
  }).map((r) => r.label).filter((l: string) => !o.tags.includes(l));
}

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 100));

    if (path === "/api/orders" && method === "GET") {
      for (const o of ORDERS) o.suggested = matching(o);
      const tags = [...new Set(ORDERS.flatMap((o) => o.tags))].sort();
      return json({ orders: ORDERS, meta: { total: ORDERS.length, tagged: ORDERS.filter((o) => o.tags.length).length, untagged: ORDERS.filter((o) => !o.tags.length).length, suggestions: ORDERS.reduce((s, o) => s + matching(o).length, 0), tags } });
    }
    const idm = path.match(/\/api\/orders\/(\d+)(\/tags(?:\/(.+))?)?$/);
    if (idm) {
      const o = ORDERS.find((x) => x.id === Number(idm[1]));
      if (idm[2] && method === "POST") { if (!o.tags.includes(body.label)) o.tags.push(body.label); o.tag_log.push({ label: body.label, action: "add", by: "Front Desk", at: new Date().toISOString() }); return json({ tags: o.tags, tag_log: o.tag_log }); }
      if (idm[2] && method === "DELETE") { const lbl = decodeURIComponent(idm[3]); o.tags = o.tags.filter((t: string) => t !== lbl); o.tag_log.push({ label: lbl, action: "remove", by: "Front Desk", at: new Date().toISOString() }); return json({ tags: o.tags, tag_log: o.tag_log }); }
      return json({ order: o });
    }
    if (path === "/api/rules" && method === "GET") return json({ rules: RULES });
    if (path === "/api/rules" && method === "POST") { const r = { id: ++RID, label: body.label, min_total: body.min_total, status_is: body.status_is, currency_is: body.currency_is, repeat_customer: !!body.repeat_customer }; RULES.push(r); return json({ rule: r }, 201); }
    if (path.startsWith("/api/rules/") && method === "DELETE") { RULES = RULES.filter((r) => String(r.id) !== path.split("/").pop()); return json({ ok: true }); }
    if (path === "/api/rules/apply" && method === "POST") { let tagged = 0, added = 0; for (const o of ORDERS) { const w = matching(o); if (w.length) { o.tags.push(...w); o.tag_log.push(...w.map((l: string) => ({ label: l, action: "auto", by: "Rules", at: new Date().toISOString() }))); tagged++; added += w.length; } } return json({ scanned: ORDERS.length, tagged, tags_added: added }); }
    return new Response("{}", { status: 404 });
  };
}

export function mockSession(): BvSession {
  return {
    inkress: { notify: ({ message }: any) => console.log("[toast]", message) } as any,
    merchant: { id: 183, username: "bookerva-jackjack", name: "Jack Jack Barbershop", currency_code: "JMD", email: "jack@example.com", logo: null },
    user: { id: 90, name: "Front Desk", email: "desk@jackjack.com" },
    scopes: ["orders:read", "orders:write"],
  };
}
