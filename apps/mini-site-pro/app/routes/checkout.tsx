// POST /checkout — public: create an Inkress hosted-checkout order for a product,
// acting as the merchant via the stored offline token. Returns payment_url.
import { eq } from "drizzle-orm";
import type { Route } from "./+types/checkout";
import { appKit, merchantAdmin } from "~/lib/app-kit.server.mjs";
import { site } from "~/db/schema.server.mjs";

const round2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

export async function action({ request }: Route.ActionArgs) {
  const storage = appKit.storage;
  if (!storage || !appKit.tokens) return Response.json({ error: "unavailable", message: "Checkout isn’t available." }, { status: 503 });
  await storage.raw.ensure();
  const b = (await request.json().catch(() => ({}))) as any;

  const s = (await storage.db.select().from(site).where(eq(site.handle, String(b.handle || ""))).limit(1))[0];
  if (!s || !s.published) return Response.json({ error: "closed", message: "This shop isn’t available right now." }, { status: 404 });
  const p = await storage.raw.one(`SELECT * FROM products WHERE id=$1 AND merchant_id=$2 AND active=true`, [Number(b.product_id), s.merchantId]);
  if (!p) return Response.json({ error: "no_product", message: "That product isn’t available." }, { status: 404 });

  const email = String(b.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "bad_email", message: "Enter a valid email.", field: "email" }, { status: 400 });

  let admin;
  try {
    admin = await merchantAdmin(s.merchantId);
  } catch {
    return Response.json({ error: "not_connected", message: "This shop hasn’t finished setup." }, { status: 503 });
  }

  const total = round2(p.price);
  const ref = `msp-${s.merchantId}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
  const nm = String(b.name || "Customer").trim().split(/\s+/).filter(Boolean);
  let created: any;
  try {
    const resp = await admin.orders.create({
      reference_id: ref,
      total,
      kind: "online",
      currency_code: p.currency,
      title: `${p.name} — ${s.businessName || "Shop"}`,
      customer: { email, first_name: nm[0] || "Customer", last_name: nm.slice(1).join(" ") || "" },
      meta_data: { source: "mini-site-pro", handle: s.handle, product: p.name },
    });
    created = resp?.result ?? resp;
  } catch (e) {
    return Response.json({ error: "order_failed", message: (e as Error)?.message || "Couldn’t start checkout — try again." }, { status: 502 });
  }

  const paymentUrl = created?.payment_urls?.payment_url || created?.payment_url || null;
  await storage.raw.run(
    `INSERT INTO orders (merchant_id,ref,product_name,customer_name,customer_email,total,currency,inkress_order_id,payment_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [s.merchantId, ref, p.name, b.name || null, email, total, p.currency, created?.id != null ? String(created.id) : null, paymentUrl],
  );
  return Response.json({ ok: true, payment_url: paymentUrl });
}
