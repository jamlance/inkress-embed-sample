// Public storefront — GET /s/:handle (and served on custom domains). No auth.
import { eq } from "drizzle-orm";
import type { Route } from "./+types/s.$handle";
import { appKit } from "~/lib/app-kit.server.mjs";
import { toStoreProduct, toStoreSite } from "~/lib/site.server.mjs";
import { site } from "~/db/schema.server.mjs";
import { Storefront } from "~/components/storefront";

export async function loader({ params }: Route.LoaderArgs) {
  const storage = appKit.storage;
  if (!storage) throw new Response("Unavailable", { status: 503 });
  await storage.raw.ensure(); // tables exist even on a cold public visit (no prior session)
  const s = (await storage.db.select().from(site).where(eq(site.handle, params.handle)).limit(1))[0];
  if (!s || !s.published) throw new Response("Not published", { status: 404 });
  const rows = await storage.raw.q(
    `SELECT id,name,description,price,currency,image_url FROM products WHERE merchant_id=$1 AND active=true ORDER BY sort, id`,
    [s.merchantId],
  );
  const paid = await storage.raw
    .one(`SELECT COUNT(*)::int n FROM orders WHERE merchant_id=$1 AND state='paid'`, [s.merchantId])
    .catch(() => ({ n: 0 }));
  return { site: toStoreSite(s), products: rows.map(toStoreProduct), paidCount: paid?.n || 0 };
}

export function meta({ data }: Route.MetaArgs) {
  const name = data?.site?.business_name || "Shop";
  const desc = data?.site?.tagline || "";
  return [{ title: name }, { name: "description", content: desc }, { property: "og:title", content: name }];
}

export default function StorefrontPage({ loaderData }: Route.ComponentProps) {
  return <Storefront site={loaderData.site} products={loaderData.products} paidCount={loaderData.paidCount} />;
}

export function ErrorBoundary() {
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", fontFamily: "system-ui", textAlign: "center", padding: 40 }}>
      <div>
        <h1>This site isn’t published yet.</h1>
        <p style={{ color: "#888" }}>Check back soon.</p>
      </div>
    </div>
  );
}
