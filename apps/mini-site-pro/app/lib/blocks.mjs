// Isomorphic block metadata + pure helpers. Plain ESM (NO node builtins) so BOTH
// the Node server and the Vite client/SSR can import it. Used by the builder
// (client) and the storefront render (SSR).

export const BLOCK_TYPES = ["hero", "products", "text", "gallery", "links", "contact", "hours", "testimonials"];

// Theme presets. `accent` is the brand colour (hex so the colour input + the
// server validator agree); the storefront derives tint/ink from it in CSS.
// `align` varies the hero layout so storefronts don't all feel identical.
export const THEMES = {
  clay: { label: "Clay", accent: "#bd5d3a", align: "left" },
  fresh: { label: "Indigo", accent: "#4f46e5", align: "center" },
  sunset: { label: "Sunset", accent: "#e8590c", align: "left" },
  forest: { label: "Forest", accent: "#2b8a3e", align: "center" },
  mono: { label: "Ink", accent: "#2f2a26", align: "left" },
  rose: { label: "Rose", accent: "#c2255c", align: "center" },
};

export const DEFAULT_THEME = "clay";

export const BLOCK_META = {
  hero: { label: "Hero", icon: "✨", summary: (d) => d.title || "Name & tagline", def: () => ({}) },
  products: { label: "Products", icon: "🛍️", summary: (d) => d.heading || "Shop", def: () => ({ heading: "Shop" }) },
  text: { label: "Text", icon: "📝", summary: (d) => d.heading || (d.body || "").slice(0, 40) || "A paragraph", def: () => ({ heading: "About", body: "" }) },
  gallery: { label: "Gallery", icon: "🖼️", summary: (d) => `${(d.images || []).length} image(s)`, def: () => ({ heading: "Gallery", images: [] }) },
  links: { label: "Links", icon: "🔗", summary: (d) => `${(d.links || []).length} link(s)`, def: () => ({ heading: "Find us", links: [] }) },
  contact: { label: "Contact", icon: "📞", summary: (d) => [d.phone, d.email, d.address].filter(Boolean).join(" · ") || "Contact details", def: () => ({ heading: "Contact", phone: "", email: "", address: "" }) },
  hours: { label: "Hours", icon: "🕑", summary: (d) => `${(d.rows || []).length} row(s)`, def: () => ({ heading: "Opening hours", rows: [] }) },
  testimonials: { label: "Testimonials", icon: "💬", summary: (d) => `${(d.items || []).length} quote(s)`, def: () => ({ heading: "What customers say", items: [] }) },
};

export const arr = (v) => (Array.isArray(v) ? v : []);
export const slugify = (s) =>
  String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
export const newBlockId = () => Math.random().toString(16).slice(2, 10);

export function money(n, code = "JMD") {
  try {
    return new Intl.NumberFormat("en-JM", { style: "currency", currency: code }).format(Number(n) || 0);
  } catch {
    return `${code} ${Number(n) || 0}`;
  }
}

export function shortDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-JM", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return String(iso).slice(0, 10);
  }
}
