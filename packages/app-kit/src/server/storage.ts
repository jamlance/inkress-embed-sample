// App DATA persistence — SERVER ONLY.
//
// StorageAdapter is what an app codes against; createDrizzleStorage is the
// default Postgres impl. The app defines its own Drizzle schema (typed queries);
// the same schema-pinned pg.Pool also powers a raw-SQL escape hatch and the
// webhook idempotency table. Kept separate from the session store and the
// offline token store (which live in the same per-app schema as kit tables).

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { SchemaPg } from "./pg";

export const KIT_WEBHOOK_DDL = `
  CREATE TABLE IF NOT EXISTS webhook_seen (
    webhook_id TEXT PRIMARY KEY,
    seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

export interface StorageAdapter<TSchema extends Record<string, unknown> = Record<string, never>> {
  /** Typed Drizzle handle over the app's schema (the app defines the tables). */
  db: NodePgDatabase<TSchema>;
  /** Raw-SQL escape hatch (q / one / run / tx), schema pinned. */
  raw: SchemaPg;
  /**
   * Webhook idempotency gate. Atomically records `id`; returns true if this id
   * has been seen BEFORE (a duplicate delivery → skip), false the first time
   * (→ process). Caller must pass a stable id (e.g. the webhook delivery id).
   * Usage: `if (await storage.isDuplicateWebhook(id)) return;`
   */
  isDuplicateWebhook(id: string): Promise<boolean>;
}

export function createDrizzleStorage<TSchema extends Record<string, unknown> = Record<string, never>>(
  raw: SchemaPg,
  schema?: TSchema,
): StorageAdapter<TSchema> {
  const db = (schema ? drizzle(raw.pool, { schema }) : drizzle(raw.pool)) as NodePgDatabase<TSchema>;
  return {
    db,
    raw,
    async isDuplicateWebhook(id: string): Promise<boolean> {
      if (!id) return false; // no id → can't dedupe; process (upstream should always pass one)
      const r = await raw.run(`INSERT INTO webhook_seen (webhook_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
      return (r.rowCount ?? 0) === 0; // 0 rows inserted → row already existed → duplicate
    },
  };
}
