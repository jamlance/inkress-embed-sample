// POST /api/sections — save the builder's blocks (authoritative server sanitize).
import { eq } from "drizzle-orm";
import type { Route } from "./+types/api.sections";
import { appKit, requireMerchant } from "~/lib/app-kit.server.mjs";
import { sanitizeSections } from "~/lib/site.server.mjs";
import { site } from "~/db/schema.server.mjs";

export async function action(args: Route.ActionArgs) {
  const { merchantId } = requireMerchant(args);
  const storage = appKit.storage;
  if (!storage) return Response.json({ error: "no_db" }, { status: 503 });
  const body = (await args.request.json().catch(() => ({}))) as { sections?: unknown };
  const sections = sanitizeSections(body.sections);
  await storage.db.update(site).set({ sections }).where(eq(site.merchantId, merchantId));
  return Response.json({ ok: true, sections });
}
