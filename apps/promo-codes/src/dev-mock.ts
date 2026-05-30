/** DEV-ONLY preview harness — tree-shaken from prod. */
import type { BvSession } from "./bv-init";

let CODES: any[] = [
  { id: 1, code: "WELCOME10", kind: "percent", value: 10, min_spend: 0, max_uses: null, used_count: 14, expires_on: null, active: true, currency: "JMD" },
  { id: 2, code: "BIGSPEND500", kind: "fixed", value: 500, min_spend: 5000, max_uses: 100, used_count: 23, expires_on: "2026-12-31", active: true, currency: "JMD" },
  { id: 3, code: "EASTER25", kind: "percent", value: 25, min_spend: 0, max_uses: 50, used_count: 50, expires_on: "2026-04-30", active: false, currency: "JMD" },
];
let CID = 3;
const REDS: any[] = [
  { id: 1, code: "WELCOME10", original: 5000, discount: 500, net: 4500, currency: "JMD", customer: "Maria Brown", payment_url: "https://pay.dev/x", inkress_order_id: "2390", state: "paid", created_at: new Date(Date.now() - 36e5).toISOString() },
  { id: 2, code: "BIGSPEND500", original: 8000, discount: 500, net: 7500, currency: "JMD", customer: "Devon Clarke", payment_url: "https://pay.dev/y", inkress_order_id: "2391", state: "awaiting", created_at: new Date(Date.now() - 72e5).toISOString() },
];
let RID = 2;

function disc(c: any, amt: number) {
  if (!c.active) return { ok: false, reason: "inactive" };
  if (c.expires_on && new Date(c.expires_on) < new Date(new Date().toISOString().slice(0, 10))) return { ok: false, reason: "expired" };
  if (c.max_uses != null && c.used_count >= c.max_uses) return { ok: false, reason: "used_up" };
  if (amt < c.min_spend) return { ok: false, reason: "min_spend" };
  const d = c.kind === "percent" ? Math.round(amt * c.value / 100) : Math.min(c.value, amt);
  return { ok: true, discount: d, net: amt - d };
}

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url, location.origin);
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 90));
    const cm = u.pathname.match(/\/api\/codes\/(\d+)/);
    const rm = u.pathname.match(/\/api\/redemptions\/(\d+)\/poll/);

    if (u.pathname === "/api/codes" && method === "GET") return json({ codes: CODES, stats: { active: CODES.filter((c) => c.active).length, redemptions: REDS.length, discount_given: REDS.filter((r) => r.state === "paid").reduce((s, r) => s + r.discount, 0) } });
    if (u.pathname === "/api/codes" && method === "POST") { const c = { id: ++CID, code: String(body.code).toUpperCase(), kind: body.kind, value: body.value, min_spend: body.min_spend || 0, max_uses: body.max_uses ? Number(body.max_uses) : null, used_count: 0, expires_on: body.expires_on || null, active: true, currency: "JMD" }; CODES.unshift(c); return json({ code: c }, 201); }
    if (cm && method === "PATCH") { const c = CODES.find((x) => x.id === Number(cm[1])); Object.assign(c, body, { max_uses: body.max_uses ? Number(body.max_uses) : c.max_uses }); return json({ code: c }); }
    if (cm && method === "DELETE") { CODES = CODES.filter((x) => x.id !== Number(cm[1])); return json({ ok: true }); }
    if (u.pathname === "/api/validate") { const c = CODES.find((x) => x.code === String(body.code).toUpperCase()); if (!c) return json({ valid: false, reason: "not_found" }); const r = disc(c, body.amount); return json(r.ok ? { valid: true, ...r, code: c.code } : { valid: false, reason: r.reason }); }
    if (u.pathname === "/api/charge") { const c = CODES.find((x) => x.code === String(body.code).toUpperCase()); if (!c) return json({ error: "bad_code", message: "Code not found." }, 400); const r = disc(c, body.amount); if (!r.ok) return json({ error: "code_invalid", reason: r.reason, message: "Can't apply." }, 400); c.used_count++; const red = { id: ++RID, code: c.code, original: body.amount, discount: r.discount, net: r.net, currency: "JMD", customer: body.customer?.name || "Customer", payment_url: "https://pay.dev.inkress.com/" + RID, inkress_order_id: String(2400 + RID), state: "awaiting", created_at: new Date().toISOString() }; REDS.unshift(red); return json({ redemption: red, payment_url: red.payment_url }); }
    if (u.pathname === "/api/redemptions" && method === "GET") return json({ redemptions: REDS });
    if (rm) { const r = REDS.find((x) => x.id === Number(rm[1])); return json({ changed: false }); }
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
