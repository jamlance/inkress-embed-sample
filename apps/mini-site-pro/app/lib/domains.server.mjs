// Custom-domain serving — when the request Host is a merchant's active custom
// domain, rewrite to that merchant's published storefront route (/s/<handle>).
// SERVER ONLY (mounted before RR7 in server.mjs).
import { and, eq } from "drizzle-orm";
import { appKit } from "./app-kit.server.mjs";
import { customDomains, site } from "../db/schema.server.mjs";

// Hosts we serve the app/editor on directly (never treated as custom domains).
const APP_HOSTS = /(\.apps\.inkress\.com|\.webapps\.host|localhost|127\.0\.0\.1)$/i;

export async function customDomainMiddleware(req, res, next) {
  const host = String(req.hostname || "").toLowerCase();
  if (!host || APP_HOSTS.test(host)) return next();
  // Only rewrite top-level GETs; let API/asset/webhook/bridge/storefront paths through.
  if (
    req.method !== "GET" ||
    req.path.startsWith("/s/") ||
    req.path.startsWith("/assets") ||
    req.path.startsWith("/__bv") ||
    req.path.startsWith("/webhooks") ||
    req.path.startsWith("/checkout") ||
    req.path.includes(".")
  ) {
    return next();
  }
  try {
    const storage = appKit.storage;
    if (!storage) return next();
    const cd = (
      await storage.db
        .select({ merchantId: customDomains.merchantId })
        .from(customDomains)
        .where(and(eq(customDomains.domain, host), eq(customDomains.status, "active")))
        .limit(1)
    )[0];
    if (!cd) return next();
    const s = (
      await storage.db.select({ handle: site.handle }).from(site).where(eq(site.merchantId, cd.merchantId)).limit(1)
    )[0];
    if (!s?.handle) return next();
    // Rewrite so the RR7 storefront route renders it.
    req.url = `/s/${s.handle}`;
    return next();
  } catch {
    return next();
  }
}
