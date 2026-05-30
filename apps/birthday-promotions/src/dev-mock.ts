/** DEV-ONLY preview harness — tree-shaken from prod. */
import type { BvSession } from "./bv-init";

function bdayIn(days: number) { const d = new Date(); d.setDate(d.getDate() + days); d.setFullYear(1990); return d.toISOString().slice(0, 10); }
let CONTACTS: any[] = [
  { id: 1, name: "Maria Brown", email: "maria@example.com", birthday: bdayIn(0), last_sent_year: null },
  { id: 2, name: "Devon Clarke", email: "devon@example.com", birthday: bdayIn(3), last_sent_year: null },
  { id: 3, name: "Aaliyah Wright", email: null, birthday: bdayIn(12), last_sent_year: null },
  { id: 4, name: "Kemar Lewis", email: "kemar@example.com", birthday: bdayIn(45), last_sent_year: 2025 },
  { id: 5, name: "Shanice Reid", email: "shanice@example.com", birthday: bdayIn(120), last_sent_year: null },
];
let CID = 5;
let SETTINGS: any = { subject: "Happy Birthday from {{shop}}! 🎂", body: "We're celebrating you, {{name}}! Pop in this week and enjoy a treat on the house.", code: "BDAY10", days_before: 0 };
const LOG: any[] = [{ id: 1, email: "kemar@example.com", code: "BDAY10", sent_by_name: "Front Desk", created_at: new Date(Date.now() - 9e7).toISOString() }];

function daysUntil(b: string) { const now = new Date(); const t = new Date(b); const next = new Date(now.getFullYear(), t.getMonth(), t.getDate()); if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next.setFullYear(now.getFullYear() + 1); return Math.round((+next - +new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000); }
const ser = (c: any) => ({ ...c, days_until: daysUntil(c.birthday) });

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url, location.origin);
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 80));
    const cm = u.pathname.match(/\/api\/contacts\/(\d+)/);

    if (u.pathname === "/api/contacts" && method === "GET") { const rows = CONTACTS.map(ser); const up = rows.filter((c) => c.days_until <= 30).sort((a, b) => a.days_until - b.days_until); return json({ contacts: rows.sort((a, b) => a.name.localeCompare(b.name)), upcoming: up, ses_configured: true, stats: { total: rows.length, upcoming: up.length, with_email: rows.filter((c) => c.email).length } }); }
    if (u.pathname === "/api/contacts" && method === "POST") { CONTACTS.push({ id: ++CID, name: body.name, email: body.email || null, birthday: body.birthday, last_sent_year: null }); return json({ ok: true }, 201); }
    if (cm && method === "DELETE") { CONTACTS = CONTACTS.filter((c) => c.id !== Number(cm[1])); return json({ ok: true }); }
    if (cm && u.pathname.endsWith("/send")) { LOG.unshift({ id: LOG.length + 1, email: "x@example.com", code: SETTINGS.code, sent_by_name: "Front Desk", created_at: new Date().toISOString() }); return json({ ok: true }); }
    if (u.pathname === "/api/settings" && method === "GET") return json({ settings: SETTINGS, ses_configured: true });
    if (u.pathname === "/api/settings" && method === "POST") { SETTINGS = { ...SETTINGS, ...body }; return json({ settings: SETTINGS }); }
    if (u.pathname === "/api/log") return json({ log: LOG });
    return new Response("{}", { status: 404 });
  };
}

export function mockSession(): BvSession {
  return {
    inkress: { notify: ({ message }: any) => console.log("[toast]", message) } as any,
    merchant: { id: 183, username: "bookerva-jackjack", name: "Jack Jack Barbershop", currency_code: "JMD", email: "jack@example.com", logo: null },
    user: { id: 90, name: "Front Desk", email: "desk@jackjack.com" },
    scopes: ["merchant_profile:read"],
  };
}
