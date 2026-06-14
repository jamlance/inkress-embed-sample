// POST /api/domains — connect/remove a custom domain (intent-based).
import type { Route } from "./+types/api.domains";
import { appKit, requireMerchant } from "~/lib/app-kit.server.mjs";
import { isDomain } from "~/lib/site.server.mjs";

const TARGET = process.env.CUSTOM_DOMAIN_TARGET || "89.167.13.203";
const APP_HOSTS = /(\.apps\.inkress\.com|\.webapps\.host|localhost)$/i;

export async function action(args: Route.ActionArgs) {
  const { merchantId } = requireMerchant(args);
  const storage = appKit.storage;
  if (!storage) return Response.json({ error: "no_db" }, { status: 503 });
  const raw = storage.raw;
  const b = (await args.request.json().catch(() => ({}))) as any;

  if (b.intent === "remove") {
    await raw.run(`DELETE FROM custom_domains WHERE id=$1 AND merchant_id=$2`, [Number(b.id), merchantId]);
    return Response.json({ ok: true });
  }

  const domain = String(b.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain) return Response.json({ error: "required", message: "Enter a domain.", field: "domain" }, { status: 400 });
  if (!isDomain(domain)) return Response.json({ error: "bad_domain", message: "Enter a valid domain like shop.yourbrand.com.", field: "domain" }, { status: 400 });
  if (APP_HOSTS.test(domain)) return Response.json({ error: "reserved", message: "That domain can’t be used.", field: "domain" }, { status: 400 });
  const taken = await raw.one(`SELECT merchant_id FROM custom_domains WHERE domain=$1`, [domain]);
  if (taken && Number(taken.merchant_id) !== merchantId)
    return Response.json({ error: "taken", message: "That domain is already connected to another shop.", field: "domain" }, { status: 409 });
  const row = await raw.one(
    `INSERT INTO custom_domains (merchant_id,domain) VALUES ($1,$2)
     ON CONFLICT (domain) DO UPDATE SET merchant_id=EXCLUDED.merchant_id RETURNING id,domain,status`,
    [merchantId, domain],
  );
  return Response.json(
    {
      ok: true,
      domain: row,
      instructions: {
        a_record: { host: domain, type: "A", value: TARGET },
        note: "Add this A record at your DNS provider, then your storefront goes live on it.",
      },
    },
    { status: 201 },
  );
}
