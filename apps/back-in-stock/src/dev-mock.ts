/** DEV-ONLY preview harness — tree-shaken from prod. */
import type { BvSession } from "./bv-init";

const PRODUCTS: any[] = [
  { id: "86", title: "Afro Fade Kit", stock: 0, unlimited: false, watch_id: 1 },
  { id: "85", title: "Beard Oil 50ml", stock: 3, unlimited: false, watch_id: null },
  { id: "84", title: "Clipper Guards Set", stock: 0, unlimited: false, watch_id: 2 },
  { id: "83", title: "Styling Pomade", stock: 28, unlimited: false, watch_id: null },
  { id: "82", title: "Gift Card", stock: null, unlimited: true, watch_id: null },
];
let WATCHES: any[] = [
  { id: 1, product_id: "86", product_title: "Afro Fade Kit", threshold: 1, waiting: 7, notified: 0, public_url: location.origin + "/notify/1" },
  { id: 2, product_id: "84", product_title: "Clipper Guards Set", threshold: 1, waiting: 2, notified: 5, public_url: location.origin + "/notify/2" },
];
let WID = 2;
const WAIT: Record<number, any[]> = { 1: [{ id: 1, email: "maria@example.com", notified_at: null, created_at: new Date().toISOString() }, { id: 2, email: "devon@example.com", notified_at: null, created_at: new Date().toISOString() }], 2: [] };
const LOG: any[] = [{ id: 1, product_title: "Clipper Guards Set", count: 5, sent_by_name: "Front Desk", created_at: new Date(Date.now() - 9e7).toISOString() }];

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url, location.origin);
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 80));
    const wm = u.pathname.match(/\/api\/watches\/(\d+)(\/(waitlist|notify))?/);

    if (u.pathname === "/api/products") return json({ products: PRODUCTS });
    if (u.pathname === "/api/watches" && method === "GET") return json({ watches: WATCHES, ses_configured: true });
    if (u.pathname === "/api/watches" && method === "POST") { const p = PRODUCTS.find((x) => x.id === body.product_id); const w = { id: ++WID, product_id: body.product_id, product_title: body.product_title, threshold: 1, waiting: 0, notified: 0, public_url: location.origin + "/notify/" + WID }; WATCHES.unshift(w); if (p) p.watch_id = w.id; WAIT[WID] = []; return json({ watch: { id: w.id } }, 201); }
    if (wm && wm[3] === "waitlist") return json({ waitlist: WAIT[Number(wm[1])] || [] });
    if (wm && wm[3] === "notify") { const w = WATCHES.find((x) => x.id === Number(wm[1])); const n = w.waiting; w.notified += n; w.waiting = 0; LOG.unshift({ id: LOG.length + 1, product_title: w.product_title, count: n, sent_by_name: "Front Desk", created_at: new Date().toISOString() }); return json({ sent: n }); }
    if (wm && method === "DELETE") { WATCHES = WATCHES.filter((x) => x.id !== Number(wm[1])); return json({ ok: true }); }
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
