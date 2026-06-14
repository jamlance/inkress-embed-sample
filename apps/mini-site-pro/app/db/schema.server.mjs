// Mini-site Drizzle schema (per-app Postgres schema). Plain ESM so server.mjs
// (Node) and loaders/actions (Vite) share it.
import { pgTable, bigserial, bigint, text, boolean, numeric, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

export const site = pgTable("site", {
  merchantId: bigint("merchant_id", { mode: "number" }).primaryKey(),
  handle: text("handle"),
  published: boolean("published").notNull().default(false),
  businessName: text("business_name"),
  tagline: text("tagline"),
  about: text("about"),
  accent: text("accent").notNull().default("#3b5bdb"),
  theme: text("theme").notNull().default("fresh"),
  logo: text("logo"),
  heroImage: text("hero_image"),
  ctaLabel: text("cta_label").notNull().default("Shop now"),
  ctaTarget: text("cta_target").notNull().default("products"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  links: jsonb("links").notNull().default([]),
  sections: jsonb("sections").notNull().default([]),
  showProducts: boolean("show_products").notNull().default(true),
  showSocialProof: boolean("show_social_proof").notNull().default(true),
  currency: text("currency").notNull().default("JMD"),
  /** Which editor shell the merchant prefers: 'studio' (preview-first) | 'sidebar'. */
  editorLayout: text("editor_layout").notNull().default("studio"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable("products", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  merchantId: bigint("merchant_id", { mode: "number" }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  price: numeric("price").notNull().default("0"),
  currency: text("currency").notNull().default("JMD"),
  imageUrl: text("image_url"),
  productId: text("product_id"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable("orders", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  merchantId: bigint("merchant_id", { mode: "number" }).notNull(),
  ref: text("ref"),
  productName: text("product_name"),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  total: numeric("total"),
  currency: text("currency"),
  inkressOrderId: text("inkress_order_id"),
  paymentUrl: text("payment_url"),
  state: text("state").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customDomains = pgTable("custom_domains", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  merchantId: bigint("merchant_id", { mode: "number" }).notNull(),
  domain: text("domain").notNull().unique(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Idempotent DDL applied at boot (openSchemaPg). Mirrors the tables above.
export const APP_DDL = `
  CREATE TABLE IF NOT EXISTS site (
    merchant_id BIGINT PRIMARY KEY,
    handle TEXT, published BOOLEAN NOT NULL DEFAULT false,
    business_name TEXT, tagline TEXT, about TEXT,
    accent TEXT NOT NULL DEFAULT '#3b5bdb', theme TEXT NOT NULL DEFAULT 'fresh',
    logo TEXT, hero_image TEXT,
    cta_label TEXT NOT NULL DEFAULT 'Shop now', cta_target TEXT NOT NULL DEFAULT 'products',
    phone TEXT, email TEXT, address TEXT,
    links JSONB NOT NULL DEFAULT '[]', sections JSONB NOT NULL DEFAULT '[]',
    show_products BOOLEAN NOT NULL DEFAULT true, show_social_proof BOOLEAN NOT NULL DEFAULT true,
    currency TEXT NOT NULL DEFAULT 'JMD', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE site ADD COLUMN IF NOT EXISTS about TEXT;
  ALTER TABLE site ADD COLUMN IF NOT EXISTS hero_image TEXT;
  ALTER TABLE site ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]';
  ALTER TABLE site ADD COLUMN IF NOT EXISTS editor_layout TEXT NOT NULL DEFAULT 'studio';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ms_handle ON site (handle) WHERE handle IS NOT NULL;
  CREATE TABLE IF NOT EXISTS products (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL,
    name TEXT NOT NULL, description TEXT, price NUMERIC NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'JMD',
    image_url TEXT, product_id TEXT, sort INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_ms_products ON products (merchant_id, sort, id);
  CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL, ref TEXT, product_name TEXT,
    customer_name TEXT, customer_email TEXT, total NUMERIC, currency TEXT,
    inkress_order_id TEXT, payment_url TEXT, state TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS custom_domains (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL,
    domain TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (domain)
  );
`;
