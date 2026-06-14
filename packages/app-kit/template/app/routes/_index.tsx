import { Link } from "react-router";
import type { Route } from "./+types/_index";
import { useToast } from "@inkress/app-kit/client";
import { getOptionalMerchant } from "~/lib/app-kit.server.mjs";

export function meta(_: Route.MetaArgs) {
  return [{ title: "__APP_NAME__" }];
}

export async function loader(args: Route.LoaderArgs) {
  const m = getOptionalMerchant(args);
  if (!m) return { connected: false as const, orders: 0, products: 0, scopes: [] as string[] };
  // Two authenticated admin-sdk calls, server-side in the loader. The list
  // endpoints don't always populate page_info.total_entries, so we fetch a page
  // and count the entries (accurate up to the page size).
  const count = async (fn: () => Promise<any>) => {
    try {
      const r = await fn();
      return r?.result?.page_info?.total_entries ?? r?.result?.entries?.length ?? 0;
    } catch {
      return 0;
    }
  };
  const [orders, products] = await Promise.all([
    count(() => m.admin.orders.list({ page_size: 100 })),
    count(() => m.admin.products.list({ page_size: 100 })),
  ]);
  return { connected: true as const, orders, products, scopes: m.scopes };
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const toast = useToast();

  if (!loaderData.connected) {
    return (
      <div className="bv-empty">
        <h1>__APP_NAME__</h1>
        <p className="bv-muted">Open this app from your Inkress dashboard to get started.</p>
      </div>
    );
  }

  return (
    <>
      <div className="bv-stats">
        <div className="bv-stat">
          <div className="k">Orders</div>
          <div className="v">{loaderData.orders}</div>
        </div>
        <div className="bv-stat">
          <div className="k">Products</div>
          <div className="v">{loaderData.products}</div>
        </div>
        <div className="bv-stat">
          <div className="k">Granted scopes</div>
          <div className="v" style={{ fontSize: "1rem" }}>{loaderData.scopes.length}</div>
        </div>
      </div>

      <div className="bv-card">
        <div className="bv-card-title">Built on @inkress/app-kit</div>
        <p className="bv-muted">
          Those counts came from authenticated <code>admin-sdk</code> calls running server-side in the route loader —
          the access token never reaches the browser. Explore the tabs: live orders &amp; products, a payment-link
          generator (storefront-sdk), and a database-backed notes demo.
        </p>
        <div className="bv-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <Link className="bv-btn primary" to="/orders">View orders →</Link>
          <Link className="bv-btn" to="/products">Products</Link>
          <Link className="bv-btn" to="/pay">Create a payment link</Link>
          <button className="bv-btn" onClick={() => toast({ kind: "success", message: "Hello from the host toast!" })}>
            Host toast
          </button>
        </div>
      </div>
    </>
  );
}
