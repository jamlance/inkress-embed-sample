/** DEV-ONLY preview harness — tree-shaken from prod. */
import type { BvSession } from "./bv-init";

let DESIGNS: any[] = [
  { id: 1, name: "Jack Jack Gift Card", denominations: [1000, 2500, 5000, 10000], allow_custom: true, min_amount: 500, max_amount: 50000, currency: "JMD", active: true, public_url: location.origin + "/gift/1" },
];
let DID = 1;
const CARDS: any[] = [
  { id: 1, code: "GC-A1B2-C3D4", amount: 5000, balance: 2000, currency: "JMD", recipient_name: "Maria", recipient_email: "maria@example.com", state: "active", created_at: new Date(Date.now() - 9e7).toISOString() },
  { id: 2, code: "GC-E5F6-G7H8", amount: 2500, balance: 2500, currency: "JMD", recipient_name: null, recipient_email: "devon@example.com", state: "active", created_at: new Date(Date.now() - 36e5).toISOString() },
  { id: 3, code: "GC-I9J0-K1L2", amount: 10000, balance: 0, currency: "JMD", recipient_name: "Kemar", recipient_email: "kemar@example.com", state: "redeemed", created_at: new Date(Date.now() - 18e7).toISOString() },
  { id: 4, code: "GC-M3N4-O5P6", amount: 1000, balance: 1000, currency: "JMD", recipient_name: null, recipient_email: "x@example.com", state: "awaiting", created_at: new Date().toISOString() },
];
let CARDID = 4;
const REDS: any[] = [{ id: 1, code: "GC-I9J0-K1L2", amount: 10000, note: null, created_by_name: "Front Desk", created_at: new Date(Date.now() - 17e7).toISOString() }, { id: 2, code: "GC-A1B2-C3D4", amount: 3000, note: "haircut", created_by_name: "Keisha", created_at: new Date(Date.now() - 8e7).toISOString() }];
let RID = 2;

function stats() { const a = CARDS.filter((c) => c.state === "active" || c.state === "redeemed"); return { sold: a.length, outstanding: a.reduce((s, c) => s + c.balance, 0), redeemed_value: CARDS.reduce((s, c) => s + (c.amount - c.balance), 0), awaiting: CARDS.filter((c) => c.state === "awaiting").length }; }

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url, location.origin);
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 90));
    const dm = u.pathname.match(/\/api\/designs\/(\d+)/);
    const rm = u.pathname.match(/\/api\/cards\/(\d+)\/redeem/);

    if (u.pathname === "/api/cards") return json({ cards: CARDS, stats: stats() });
    if (u.pathname === "/api/cards/lookup") { const c = CARDS.find((x) => x.code === String(body.code).toUpperCase()); return json(c ? { found: true, card: c } : { found: false }); }
    if (rm) { const c = CARDS.find((x) => x.id === Number(rm[1])); c.balance = Math.round(c.balance - body.amount); if (c.balance <= 0) c.state = "redeemed"; REDS.unshift({ id: ++RID, code: c.code, amount: body.amount, note: null, created_by_name: "Front Desk", created_at: new Date().toISOString() }); return json({ card: c }); }
    if (u.pathname === "/api/redemptions") return json({ redemptions: REDS });
    if (u.pathname === "/api/designs" && method === "GET") return json({ designs: DESIGNS, connected: true, ses_configured: true });
    if (u.pathname === "/api/designs" && method === "POST") { const d = { id: ++DID, ...body, currency: "JMD", active: true, public_url: location.origin + "/gift/" + DID }; DESIGNS.unshift(d); return json({ design: d }, 201); }
    if (dm && method === "PATCH") { const d = DESIGNS.find((x) => x.id === Number(dm[1])); Object.assign(d, body); return json({ design: d }); }
    if (dm && method === "DELETE") { DESIGNS = DESIGNS.filter((x) => x.id !== Number(dm[1])); return json({ ok: true }); }
    return new Response("{}", { status: 404 });
  };
}

export function mockSession(): BvSession {
  return {
    inkress: { notify: ({ message }: any) => console.log("[toast]", message) } as any,
    merchant: { id: 183, username: "bookerva-jackjack", name: "Jack Jack Barbershop", currency_code: "JMD", email: "jack@example.com", logo: null },
    user: { id: 90, name: "Front Desk", email: "desk@jackjack.com" },
    scopes: ["orders:write", "offline_access"],
  };
}
