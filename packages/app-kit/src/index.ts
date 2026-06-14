// @inkress/app-kit — isomorphic entry.
//
// SAFE FOR BOTH SERVER AND BROWSER. Only pure types and constants live here
// (no node builtins, no secrets, no SDK instances). The server barrel and the
// client barrel both re-use these. Anything that touches a client secret, the
// admin SDK, pg, or crypto belongs in `./server/*` (never imported from here).

/** Inkress order `status` integer → lowercase name. Source of truth: admin-sdk data-mappings. */
export const ORDER_STATUS = {
  1: "pending",
  2: "error",
  3: "paid",
  4: "confirmed",
  5: "cancelled",
  6: "prepared",
  7: "shipped",
  8: "delivered",
  9: "completed",
  10: "returned",
  11: "refunded",
  12: "verifying",
  13: "stale",
  14: "archived",
  32: "partial",
} as const;

export type OrderStatusName = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/** An order is "paid enough to fulfil" once it reaches any of these states. */
export const PAID_STATES: ReadonlySet<OrderStatusName> = new Set([
  "paid",
  "confirmed",
  "prepared",
  "shipped",
  "delivered",
  "completed",
]);

type OrderLike = { status?: number | string | null; status_name?: string | null } | null | undefined;

/** Normalise an order's status to a lowercase name, accepting the integer
 *  `status`, a numeric string, or an `order_*` / bare string `status_name`. */
export function orderStatusName(order: OrderLike): OrderStatusName | "unknown" {
  const raw = order?.status_name ?? order?.status;
  if (typeof raw === "number") return (ORDER_STATUS as Record<number, OrderStatusName>)[raw] ?? "unknown";
  if (typeof raw === "string") {
    const n = Number(raw);
    if (!Number.isNaN(n)) return (ORDER_STATUS as Record<number, OrderStatusName>)[n] ?? "unknown";
    return raw.replace(/^order_/, "").toLowerCase() as OrderStatusName;
  }
  return "unknown";
}

export function isPaidStatus(order: OrderLike): boolean {
  return PAID_STATES.has(orderStatusName(order) as OrderStatusName);
}

// ---- shared identity/branding types (used by both MerchantContext + useBv) ----

export interface Merchant {
  id: number;
  username?: string | null;
  name?: string | null;
  currency_code?: string | null;
  logo?: string | null;
  [key: string]: unknown;
}

export interface BvUser {
  id: number | null;
  name: string | null;
  email?: string | null;
}

export interface BvTheme {
  mode: "light" | "dark";
  accent?: string | null;
}

/** OAuth scope string (e.g. "orders:read", "offline_access"). */
export type Scope = string;

/** Runtime mode → which Inkress API host the SDKs talk to. */
export type InkressMode = "live" | "sandbox";
