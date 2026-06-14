import { useEffect, useMemo, useRef, useState } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import type { Route } from "./+types/_app._index";
import { useToast } from "@inkress/app-kit/client";
import { appKit, requireMerchant } from "~/lib/app-kit.server.mjs";
import { ensureSite } from "~/lib/site.server.mjs";
import { Storefront } from "~/components/storefront";
import { BuildPanel, type Block } from "~/components/build-panel";
import { ProductsPanel, ThemePanel, PagePanel, SettingsPanel, type CatalogItem, type Product } from "~/components/panels";
import { ShellStudio, ShellSidebar, PANELS, type PanelKey } from "~/components/shells";

export async function loader(args: Route.LoaderArgs) {
  const { merchantId, merchant, admin, scopes } = requireMerchant(args);
  const s = await ensureSite(appKit.storage, merchantId, merchant);
  const raw = appKit.storage!.raw;
  const rows = await raw.q(`SELECT id,name,description,price,currency,image_url,active FROM products WHERE merchant_id=$1 ORDER BY sort, id`, [merchantId]);
  const products: Product[] = rows.map((p: any) => ({ id: Number(p.id), name: p.name, description: p.description, price: Number(p.price), currency: p.currency, image_url: p.image_url, active: p.active }));
  const stats = await raw.one(`SELECT COUNT(*)::int orders, COALESCE(SUM(total),0) revenue FROM orders WHERE merchant_id=$1 AND state='paid'`, [merchantId]).catch(() => ({ orders: 0, revenue: 0 }));
  const domains = await raw.q(`SELECT id,domain,status FROM custom_domains WHERE merchant_id=$1 ORDER BY id DESC`, [merchantId]);

  const currency = (s.currency as string) || "JMD";
  let catalog: CatalogItem[] = [];
  const catalogAvailable = scopes.includes("products:read");
  if (catalogAvailable) {
    try {
      const r: any = await admin.products.list({ page_size: 50 });
      catalog = (r?.result?.entries || []).map((p: any) => ({ id: String(p.id), title: p.title || `Product ${p.id}`, description: p.teaser || null, price: Number(p.price) || 0, image: p.image || null, currency: p.currency_code || currency }));
    } catch {
      /* catalog unavailable */
    }
  }

  const origin = process.env.PUBLIC_BASE_URL || new URL(args.request.url).origin;
  return {
    handle: s.handle as string,
    published: s.published as boolean,
    publicUrl: `${origin}/s/${s.handle}`,
    layout: (s.editorLayout as string) === "sidebar" ? "sidebar" : "studio",
    brand: {
      businessName: (s.businessName as string) || "",
      tagline: (s.tagline as string) || "",
      about: (s.about as string) || "",
      logo: (s.logo as string) || "",
      accent: (s.accent as string) || "#bd5d3a",
      theme: (s.theme as string) || "clay",
    },
    sections: (s.sections as Block[]) || [],
    products,
    catalog,
    catalogAvailable,
    currency,
    orders: stats.orders,
    revenue: Number(stats.revenue) || 0,
    productCount: products.length,
    domains: domains as { id: number; domain: string; status: string }[],
  };
}

export default function Workspace({ loaderData }: Route.ComponentProps) {
  const toast = useToast();
  const rev = useRevalidator();
  const [searchParams] = useSearchParams();

  const [layout, setLayout] = useState<"studio" | "sidebar">(loaderData.layout as "studio" | "sidebar");
  const [panel, setPanel] = useState<PanelKey>(() => {
    const q = searchParams.get("panel") as PanelKey | null;
    return q && PANELS.some((p) => p.key === q) ? q : "build";
  });
  const [sections, setSections] = useState<Block[]>(loaderData.sections);
  const [saved, setSaved] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [brand, setBrand] = useState(loaderData.brand);
  const brandSave = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep section state in sync if the server data changes underneath us.
  useEffect(() => { setSections(loaderData.sections); }, [loaderData.sections]);

  function patchBrand(p: Partial<typeof brand>) {
    const next = { ...brand, ...p };
    setBrand(next);
    if (brandSave.current) clearTimeout(brandSave.current);
    brandSave.current = setTimeout(() => {
      fetch("/api/site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: next.businessName,
          tagline: next.tagline,
          about: next.about,
          logo: next.logo,
          accent: next.accent,
          theme: next.theme,
        }),
      }).catch(() => {});
    }, 600);
  }

  async function onPublish() {
    setPublishing(true);
    await fetch("/api/site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "publish", published: !loaderData.published }) }).catch(() => {});
    setPublishing(false);
    rev.revalidate();
  }

  const previewSite = useMemo(
    () => ({
      handle: loaderData.handle,
      business_name: brand.businessName,
      tagline: brand.tagline,
      accent: brand.accent,
      theme: brand.theme,
      logo: brand.logo,
      show_social_proof: true,
      currency: loaderData.currency,
      sections,
    }),
    [loaderData.handle, loaderData.currency, brand, sections],
  );
  // loaderData.products already matches StoreProduct (id/name/description/price/currency/image_url).
  const previewProducts = loaderData.products;

  const onChanged = () => rev.revalidate();

  const panelNode = (() => {
    switch (panel) {
      case "build":
        return <BuildPanel sections={sections} setSections={setSections} saved={saved} setSaved={setSaved} />;
      case "products":
        return <ProductsPanel products={loaderData.products} catalog={loaderData.catalog} catalogAvailable={loaderData.catalogAvailable} currency={loaderData.currency} onChanged={onChanged} />;
      case "theme":
        return <ThemePanel site={{ ...brand, handle: loaderData.handle, published: loaderData.published, currency: loaderData.currency }} patch={patchBrand} />;
      case "page":
        return <PagePanel site={{ ...brand, handle: loaderData.handle, published: loaderData.published, currency: loaderData.currency }} publicUrl={loaderData.publicUrl} orders={loaderData.orders} revenue={loaderData.revenue} productCount={loaderData.productCount} domains={loaderData.domains} onChanged={onChanged} toast={toast} />;
      case "settings":
        return <SettingsPanel layout={layout} onLayout={setLayout} />;
    }
  })();

  const preview = <Storefront site={previewSite} products={previewProducts} preview />;

  const shellProps = {
    brand: { name: brand.businessName, logo: brand.logo, accent: brand.accent },
    handle: loaderData.handle,
    published: loaderData.published,
    publicUrl: loaderData.publicUrl,
    panel,
    setPanel,
    panelNode,
    preview,
    onPublish,
    publishing,
  };

  return layout === "sidebar" ? <ShellSidebar {...shellProps} /> : <ShellStudio {...shellProps} />;
}
