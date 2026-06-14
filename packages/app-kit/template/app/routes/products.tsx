import type { Route } from "./+types/products";
import { requireMerchant } from "~/lib/app-kit.server.mjs";
import { money } from "~/lib/format";

export async function loader(args: Route.LoaderArgs) {
  const { admin } = requireMerchant(args);
  try {
    const r = await admin.products.list({ page_size: 24 });
    return { products: r?.result?.entries ?? [], total: r?.result?.page_info?.total_entries ?? 0, error: null as string | null };
  } catch (e) {
    return { products: [], total: 0, error: (e as Error).message };
  }
}

export default function Products({ loaderData }: Route.ComponentProps) {
  const { products, total, error } = loaderData;
  return (
    <div className="bv-card">
      <div className="bv-card-title">Catalog {total ? `· ${total} products` : ""}</div>
      {error && <div className="bv-banner">Couldn’t load products: {error}</div>}
      {products.length === 0 ? (
        <div className="bv-empty">
          <p className="bv-muted">No products in this merchant’s catalog.</p>
        </div>
      ) : (
        <div className="bv-grid">
          {products.map((p: any) => (
            <div key={p.id} className="bv-prod">
              <div
                className="bv-prod-img"
                style={p.image ? { backgroundImage: `url('${p.image}')` } : undefined}
              >
                {!p.image && (p.title || "?").slice(0, 1)}
              </div>
              <div className="bv-prod-body">
                <div className="bv-prod-name">{p.title}</div>
                <div className="bv-row" style={{ justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700 }}>{money(p.price, p.currency_code)}</span>
                  <span className={`bv-badge ${p.public ? "ok" : ""}`}>{p.public ? "public" : p.status}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
