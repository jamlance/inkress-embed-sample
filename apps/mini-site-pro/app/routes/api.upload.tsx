// POST /api/upload — image upload (data URL → S3 via the app-kit BlobStore).
import type { Route } from "./+types/api.upload";
import { appKit, blob, requireMerchant, decodeDataUrl, isAllowedImage } from "~/lib/app-kit.server.mjs";

export async function action(args: Route.ActionArgs) {
  const { merchantId } = requireMerchant(args);
  if (!blob.configured()) {
    return Response.json({ error: "storage_off", message: "Image hosting isn’t set up — paste an image URL instead." }, { status: 503 });
  }
  const b = (await args.request.json().catch(() => ({}))) as { data?: string };
  const decoded = decodeDataUrl(b.data || "");
  if (!decoded || !isAllowedImage(decoded.contentType)) {
    return Response.json({ error: "bad_image", message: "Upload a JPG, PNG, WEBP, GIF or SVG image." }, { status: 400 });
  }
  if (decoded.body.length > 5 * 1024 * 1024) {
    return Response.json({ error: "too_big", message: "Image must be under 5 MB." }, { status: 400 });
  }
  try {
    const { url } = await blob.put({ prefix: `mini-site/${merchantId}`, body: decoded.body, contentType: decoded.contentType });
    return Response.json({ ok: true, url });
  } catch (e) {
    return Response.json({ error: "upload_failed", message: (e as Error)?.message || "Upload failed — try again." }, { status: 502 });
  }
}
