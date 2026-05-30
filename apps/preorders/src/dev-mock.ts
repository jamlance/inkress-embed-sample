/** DEV-ONLY preview harness — tree-shaken from prod. */
import type { BvSession } from "./bv-init";

let CAMPAIGNS: any[] = [
  { id: 1, title: "Limited Fade Cream (new batch)", blurb: "Our signature styling cream — reserve the next batch.", image_url: null, deposit: 1000, full_price: 3500, target_qty: 50, available_on: "2026-07-01", currency: "JMD", active: true, reserved: 31, awaiting: 4, public_url: location.origin + "/preorder/1" },
  { id: 2, title: "Barber Apron — Signature", blurb: "Leather-trim apron, pre-order before the drop.", image_url: null, deposit: 2500, full_price: 9000, target_qty: 20, available_on: null, currency: "JMD", active: true, reserved: 8, awaiting: 2, public_url: location.origin + "/preorder/2" },
];
let CID = 2;
const RES: Record<number, any[]> = {
  1: [
    { id: 1, customer_name: "Maria Brown", customer_email: "maria@example.com", deposit: 1000, currency: "JMD", state: "paid", payment_url: "#", created_at: new Date(Date.now() - 36e5).toISOString() },
    { id: 2, customer_name: "Devon Clarke", customer_email: "devon@example.com", deposit: 1000, currency: "JMD", state: "awaiting", payment_url: "#", created_at: new Date(Date.now() - 72e5).toISOString() },
  ], 2: [],
};

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url, location.origin);
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 90));
    const cm = u.pathname.match(/\/api\/campaigns\/(\d+)(\/reservations)?/);

    if (u.pathname === "/api/campaigns" && method === "GET") return json({ campaigns: CAMPAIGNS, connected: true });
    if (u.pathname === "/api/campaigns" && method === "POST") { const c = { id: ++CID, ...body, deposit: body.deposit, full_price: body.full_price ? Number(body.full_price) : null, target_qty: body.target_qty ? Number(body.target_qty) : null, currency: "JMD", active: true, reserved: 0, awaiting: 0, public_url: location.origin + "/preorder/" + CID }; CAMPAIGNS.unshift(c); RES[CID] = []; return json({ campaign: c }, 201); }
    if (cm && cm[2] === "/reservations") return json({ reservations: RES[Number(cm[1])] || [] });
    if (cm && method === "PATCH") { const c = CAMPAIGNS.find((x) => x.id === Number(cm[1])); Object.assign(c, body); return json({ campaign: c }); }
    if (cm && method === "DELETE") { CAMPAIGNS = CAMPAIGNS.filter((x) => x.id !== Number(cm[1])); return json({ ok: true }); }
    return new Response("{}", { status: 404 });
  };
}

export function mockSession(): BvSession {
  return {
    inkress: { notify: ({ message }: any) => console.log("[toast]", message) } as any,
    merchant: { id: 183, username: "bookerva-jackjack", name: "Jack Jack Barbershop", currency_code: "JMD", email: "jack@example.com", logo: null },
    user: { id: 90, name: "Front Desk", email: "desk@jackjack.com" },
    scopes: ["orders:read", "orders:write", "offline_access"],
  };
}
