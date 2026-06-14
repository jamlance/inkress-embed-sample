// Drizzle schema for this app's own tables (per-app Postgres schema).
// Plain ESM so both server.mjs (Node) and loaders/actions (Vite) import it.
import { pgTable, bigserial, bigint, text, timestamp } from "drizzle-orm/pg-core";

// Example table — a per-merchant note. Replace with your app's data.
export const notes = pgTable("notes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  merchantId: bigint("merchant_id", { mode: "number" }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// DDL applied at boot (idempotent). Keep in sync with the table above.
export const APP_DDL = `
  CREATE TABLE IF NOT EXISTS notes (
    id BIGSERIAL PRIMARY KEY,
    merchant_id BIGINT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_notes_merchant ON notes (merchant_id, id DESC);
`;
