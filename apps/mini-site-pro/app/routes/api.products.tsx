// POST /api/products — product CRUD + catalog import (intent-based).
import type { Route } from "./+types/api.products";
import { appKit, requireMerchant } from "~/lib/app-kit.server.mjs";
import { cleanUrl } from "~/lib/site.server.mjs";

const round2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const serialize = (p: any) => ({
  id: Number(p.id),
  name: p.name,
  description: p.description,
  price: Number(p.price),
  currency: p.currency,
  image_url: p.image_url,
  product_id: p.product_id,
  active: p.active,
  sort: p.sort,
});
function validateProduct(b: any) {
  if (!String(b.name || "").trim()) return { field: "name", message: "Product name is required." };
  const price = Number(b.price);
  if (b.price === "" || b.price == null || !Number.isFinite(price)) return { field: "price", message: "Enter a price." };
  if (price < 0) return { field: "price", message: "Price can’t be negative." };
  return null;
}

export async function action(args: Route.ActionArgs) {
  const { merchantId, merchant } = requireMerchant(args);
  const storage = appKit.storage;
  if (!storage) return Response.json({ error: "no_db" }, { status: 503 });
  const raw = storage.raw;
  const cur = (merchant as { currency_code?: string })?.currency_code || "JMD";
  const b = (await args.request.json().catch(() => ({}))) as any;

  if (b.intent === "create") {
    const v = validateProduct(b);
    if (v) return Response.json({ error: "invalid", message: v.message, field: v.field }, { status: 400 });
    const row = await raw.one(
      `INSERT INTO products (merchant_id,name,description,price,currency,image_url,product_id,sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE((SELECT MAX(sort)+1 FROM products WHERE merchant_id=$1),0)) RETURNING *`,
      [merchantId, String(b.name).slice(0, 100), String(b.description || "").slice(0, 500) || null, round2(b.price), cur, cleanUrl(b.image_url), b.product_id ? String(b.product_id) : null],
    );
    return Response.json({ ok: true, product: serialize(row) }, { status: 201 });
  }

  if (b.intent === "update") {
    const p = await raw.one(`SELECT * FROM products WHERE id=$1 AND merchant_id=$2`, [Number(b.id), merchantId]);
    if (!p) return Response.json({ error: "not_found", message: "Product not found." }, { status: 404 });
    if (b.name !== undefined && !String(b.name).trim())
      return Response.json({ error: "invalid", message: "Product name is required.", field: "name" }, { status: 400 });
    if (b.price !== undefined) {
      const pr = Number(b.price);
      if (!Number.isFinite(pr) || pr < 0)
        return Response.json({ error: "invalid", message: "Enter a valid price.", field: "price" }, { status: 400 });
    }
    const row = await raw.one(
      `UPDATE products SET name=$2,description=$3,price=$4,image_url=$5,active=$6 WHERE id=$1 RETURNING *`,
      [
        p.id,
        b.name !== undefined ? String(b.name).slice(0, 100) : p.name,
        b.description !== undefined ? String(b.description || "").slice(0, 500) || null : p.description,
        b.price !== undefined ? round2(b.price) : p.price,
        b.image_url !== undefined ? cleanUrl(b.image_url) : p.image_url,
        b.active !== undefined ? !!b.active : p.active,
      ],
    );
    return Response.json({ ok: true, product: serialize(row) });
  }

  if (b.intent === "delete") {
    await raw.run(`DELETE FROM products WHERE id=$1 AND merchant_id=$2`, [Number(b.id), merchantId]);
    return Response.json({ ok: true });
  }

  if (b.intent === "import") {
    const picks = Array.isArray(b.products) ? b.products.slice(0, 100) : [];
    let added = 0;
    for (const p of picks) {
      const exists = p.id ? await raw.one(`SELECT 1 FROM products WHERE merchant_id=$1 AND product_id=$2`, [merchantId, String(p.id)]) : null;
      if (exists) continue;
      await raw.run(
        `INSERT INTO products (merchant_id,name,description,price,currency,image_url,product_id,sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE((SELECT MAX(sort)+1 FROM products WHERE merchant_id=$1),0))`,
        [merchantId, String(p.title || "Product").slice(0, 100), String(p.description || "").slice(0, 500) || null, round2(p.price), p.currency || cur, cleanUrl(p.image), p.id ? String(p.id) : null],
      );
      added++;
    }
    return Response.json({ ok: true, added });
  }

  return Response.json({ error: "bad_intent" }, { status: 400 });
}
