// Client-safe formatting helpers.

export function money(n: number, code = "JMD"): string {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat("en-JM", { style: "currency", currency: code }).format(v);
  } catch {
    return `${code} ${v.toLocaleString()}`;
  }
}

export function shortDate(iso?: string | Date): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-JM", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return String(iso).slice(0, 10);
  }
}

/** order status → badge tone */
export function statusTone(status: string): "ok" | "bad" | "" {
  if (["paid", "confirmed", "completed", "delivered", "shipped", "prepared"].includes(status)) return "ok";
  if (["cancelled", "error", "refunded", "returned"].includes(status)) return "bad";
  return "";
}
