import type { Route } from "./+types/orders";
import { requireMerchant } from "~/lib/app-kit.server.mjs";
import { money, shortDate, statusTone } from "~/lib/format";

export async function loader(args: Route.LoaderArgs) {
  const { admin } = requireMerchant(args);
  try {
    const r = await admin.orders.list({ page_size: 15 });
    return { orders: r?.result?.entries ?? [], total: r?.result?.page_info?.total_entries ?? 0, error: null as string | null };
  } catch (e) {
    return { orders: [], total: 0, error: (e as Error).message };
  }
}

export default function Orders({ loaderData }: Route.ComponentProps) {
  const { orders, total, error } = loaderData;
  return (
    <div className="bv-card">
      <div className="bv-card-title">Recent orders {total ? `· ${total} total` : ""}</div>
      {error && <div className="bv-banner">Couldn’t load orders: {error}</div>}
      {orders.length === 0 ? (
        <div className="bv-empty">
          <p className="bv-muted">No orders yet.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="bv-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Customer</th>
                <th>Date</th>
                <th className="num">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o: any) => (
                <tr key={o.id}>
                  <td className="bv-mono">{o.reference_id || `#${o.id}`}</td>
                  <td>{[o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || o.customer?.email || "—"}</td>
                  <td className="bv-muted">{shortDate(o.inserted_at)}</td>
                  <td className="num">{money(o.total, o.currency_code)}</td>
                  <td>
                    <span className={`bv-badge ${statusTone(o.status)}`}>{o.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
