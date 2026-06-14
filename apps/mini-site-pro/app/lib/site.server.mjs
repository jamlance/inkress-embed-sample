// Server-only site logic — sanitize, defaults, get-or-create. Ported from the
// old apps/mini-site/server.js. Uses node crypto + the drizzle storage adapter.
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { BLOCK_TYPES, arr, slugify } from "./blocks.mjs";
import { site } from "../db/schema.server.mjs";

const newId = () => crypto.randomBytes(4).toString("hex");

export const isDomain = (d) =>
  /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i.test(d || "") && String(d || "").length <= 253;

// Accept full URLs as-is and scheme-less domains/paths (prepend https://); reject junk.
export function cleanUrl(u) {
  const s = String(u || "").trim();
  if (!s || /\s/.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s.slice(0, 600);
  if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}(\/.*)?$/i.test(s)) return ("https://" + s).slice(0, 600);
  return null;
}

// Authoritative server-side sanitizer for the blocks array. Caps lengths,
// whitelists types/fields, drops junk. Mirrors the proven mini-site logic.
export function sanitizeSections(input) {
  const cap = (v, n) => String(v || "").slice(0, n);
  return arr(input)
    .slice(0, 30)
    .map((b) => {
      if (!BLOCK_TYPES.includes(b?.type)) return null;
      const d = b.data || {};
      let data = {};
      if (b.type === "hero")
        data = {
          title: cap(d.title, 80),
          subtitle: cap(d.subtitle, 160),
          image: cleanUrl(d.image),
          cta_label: cap(d.cta_label, 30),
          cta_target: ["products", "contact", "link"].includes(d.cta_target) ? d.cta_target : "products",
        };
      else if (b.type === "products") data = { heading: cap(d.heading, 60) || "Shop" };
      else if (b.type === "text") data = { heading: cap(d.heading, 60), body: cap(d.body, 2000) };
      else if (b.type === "gallery")
        data = { heading: cap(d.heading, 60), images: arr(d.images).map(cleanUrl).filter(Boolean).slice(0, 12) };
      else if (b.type === "links")
        data = {
          heading: cap(d.heading, 60),
          links: arr(d.links).map((l) => ({ label: cap(l.label, 40), url: cleanUrl(l.url) })).filter((l) => l.label && l.url).slice(0, 12),
        };
      else if (b.type === "contact")
        data = { heading: cap(d.heading, 60), phone: cap(d.phone, 40), email: cap(d.email, 120), address: cap(d.address, 200) };
      else if (b.type === "hours")
        data = {
          heading: cap(d.heading, 60),
          rows: arr(d.rows).map((r) => ({ label: cap(r.label, 40), value: cap(r.value, 40) })).filter((r) => r.label).slice(0, 14),
        };
      else if (b.type === "testimonials")
        data = {
          heading: cap(d.heading, 60),
          items: arr(d.items).map((i) => ({ quote: cap(i.quote, 300), author: cap(i.author, 60) })).filter((i) => i.quote).slice(0, 10),
        };
      return { id: b.id && /^[a-z0-9]{1,16}$/i.test(b.id) ? b.id : newId(), type: b.type, data };
    })
    .filter(Boolean);
}

export function defaultSections(s) {
  const out = [
    { id: newId(), type: "hero", data: {} },
    { id: newId(), type: "products", data: { heading: "Shop" } },
  ];
  if (s.about) out.push({ id: newId(), type: "text", data: { heading: "About", body: s.about } });
  if (arr(s.links).length) out.push({ id: newId(), type: "links", data: { heading: "Find us", links: arr(s.links) } });
  if (s.phone || s.email || s.address)
    out.push({ id: newId(), type: "contact", data: { heading: "Contact", phone: s.phone, email: s.email, address: s.address } });
  return out;
}

export async function uniqueHandle(storage, base, mid) {
  base = base || "shop";
  for (let i = 0; i < 50; i++) {
    const cand = i === 0 ? base : `${base}-${i}`;
    const ex = await storage.raw.one(`SELECT merchant_id FROM site WHERE handle=$1`, [cand]);
    if (!ex || (mid && Number(ex.merchant_id) === mid)) return cand;
  }
  return `${base}-${crypto.randomBytes(2).toString("hex")}`;
}

/** Map a drizzle `site` row → the snake_case shape the <Storefront> component wants. */
export function toStoreSite(s) {
  return {
    handle: s.handle,
    business_name: s.businessName,
    tagline: s.tagline,
    accent: s.accent,
    theme: s.theme,
    logo: s.logo,
    hero_image: s.heroImage,
    cta_label: s.ctaLabel,
    show_social_proof: s.showSocialProof,
    currency: s.currency,
    sections: arr(s.sections),
  };
}

/** Map a product row (raw snake_case or drizzle camelCase) → store product. */
export function toStoreProduct(p) {
  return {
    id: Number(p.id),
    name: p.name,
    description: p.description ?? null,
    price: Number(p.price),
    currency: p.currency,
    image_url: p.image_url ?? p.imageUrl ?? null,
  };
}

/** Get-or-create the merchant's site row (+ default sections on first run). */
export async function ensureSite(storage, merchantId, merchant) {
  await storage.raw.ensure(); // make sure tables exist (Drizzle bypasses the lazy ensure)
  const load = async () => (await storage.db.select().from(site).where(eq(site.merchantId, merchantId)).limit(1))[0];
  let s = await load();
  if (!s) {
    const name = merchant?.name || merchant?.username || "My shop";
    const handle = await uniqueHandle(storage, slugify(name) || `shop-${merchantId}`, merchantId);
    await storage.db
      .insert(site)
      .values({
        merchantId,
        handle,
        businessName: name,
        tagline: "Quality you can count on.",
        about: `Welcome to ${name}.`,
        logo: merchant?.logo || merchant?.logo_url || null,
        currency: merchant?.currency_code || "JMD",
      })
      .onConflictDoNothing();
    s = await load();
  }
  if (!arr(s.sections).length) {
    const sections = defaultSections(s);
    await storage.db.update(site).set({ sections }).where(eq(site.merchantId, merchantId));
    s.sections = sections;
  }
  return s;
}
