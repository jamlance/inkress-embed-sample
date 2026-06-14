// POST /api/site — site-level updates: brand/theme, handle, publish (intent-based).
import { eq } from "drizzle-orm";
import type { Route } from "./+types/api.site";
import { appKit, requireMerchant } from "~/lib/app-kit.server.mjs";
import { cleanUrl, uniqueHandle } from "~/lib/site.server.mjs";
import { THEMES, slugify } from "~/lib/blocks.mjs";
import { site } from "~/db/schema.server.mjs";

export async function action(args: Route.ActionArgs) {
  const { merchantId } = requireMerchant(args);
  const storage = appKit.storage;
  if (!storage) return Response.json({ error: "no_db" }, { status: 503 });
  const b = (await args.request.json().catch(() => ({}))) as Record<string, any>;
  const set = (patch: Record<string, unknown>) =>
    storage.db.update(site).set(patch).where(eq(site.merchantId, merchantId));

  if (b.intent === "publish") {
    await set({ published: !!b.published });
    return Response.json({ ok: true, published: !!b.published });
  }

  if (b.intent === "layout") {
    const layout = b.layout === "sidebar" ? "sidebar" : "studio";
    await set({ editorLayout: layout });
    return Response.json({ ok: true, layout });
  }

  if (b.intent === "handle") {
    const want = slugify(b.handle);
    if (!want) {
      return Response.json({ error: "invalid", message: "Handle must contain letters or numbers.", field: "handle" }, { status: 400 });
    }
    const handle = await uniqueHandle(storage, want, merchantId);
    await set({ handle });
    return Response.json({ ok: true, handle, requested: want });
  }

  // brand / theme update
  const patch: Record<string, unknown> = {};
  if (b.business_name !== undefined) {
    const v = String(b.business_name).trim();
    if (!v) return Response.json({ error: "invalid", message: "Business name can’t be empty.", field: "business_name" }, { status: 400 });
    patch.businessName = v.slice(0, 80);
  }
  if (b.tagline !== undefined) patch.tagline = String(b.tagline).slice(0, 140) || null;
  if (b.about !== undefined) patch.about = String(b.about).slice(0, 1200) || null;
  if (b.logo !== undefined) patch.logo = cleanUrl(b.logo);
  if (b.accent !== undefined && /^#[0-9a-fA-F]{6}$/.test(b.accent)) patch.accent = b.accent;
  if (b.theme !== undefined && (THEMES as Record<string, unknown>)[b.theme]) patch.theme = b.theme;
  if (Object.keys(patch).length) await set(patch);
  return Response.json({ ok: true });
}
