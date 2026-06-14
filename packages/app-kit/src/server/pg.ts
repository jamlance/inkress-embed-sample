// Postgres backbone — SERVER ONLY.
//
// One DB (`APPS_DATABASE_URL`), one schema per app. We pin the schema on every
// physical connection via the pool `connect` event, so BOTH raw queries and the
// Drizzle storage adapter (which share this pool) hit the app's schema without
// per-query `SET search_path`. Ported from packages/core/src/pgdb.mjs, adapted
// from per-checkout search_path to connection-pinned + a single shared pool the
// session store, token store, and storage adapter all reuse.

import pg from "pg";

export function safeSchema(name: string): string {
  const s = String(name).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!s || /^[0-9]/.test(s)) return `app_${s}`;
  return s;
}

export interface SchemaPg {
  schema: string;
  pool: pg.Pool;
  /** Create the schema + run the (idempotent) DDL. Safe to call repeatedly. */
  ensure(): Promise<void>;
  q<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<{ rowCount: number | null; rows: any[] }>;
  tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
}

export interface OpenSchemaOptions {
  ddl?: string;
  connectionString?: string;
  max?: number;
}

export function openSchemaPg(appName: string, opts: OpenSchemaOptions = {}): SchemaPg {
  const schema = safeSchema(appName);
  const connectionString = opts.connectionString ?? process.env.APPS_DATABASE_URL;
  if (!connectionString) {
    throw new Error("APPS_DATABASE_URL is not set — the app needs a Postgres connection string.");
  }
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 6, idleTimeoutMillis: 30000 });
  pool.on("error", (e) => console.error("[app-kit/pg] pool error", e.message));
  // Pin the schema on every new physical connection. Runs after ensure() has
  // created the schema (ensure is awaited before any pooled query below).
  pool.on("connect", (c) => {
    c.query(`SET search_path TO "${schema}"`).catch(() => {});
  });

  let ensured: Promise<void> | null = null;
  const ensure = (): Promise<void> => {
    if (ensured) return ensured;
    ensured = (async () => {
      const c = await pool.connect();
      try {
        await c.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
        await c.query(`SET search_path TO "${schema}"`);
        if (opts.ddl) await c.query(opts.ddl);
      } finally {
        c.release();
      }
    })().catch((e) => {
      // Reset so a transient DB blip retries on the next call (self-heal,
      // mirrors core: the container must boot even if Postgres is briefly down).
      ensured = null;
      throw e;
    });
    return ensured;
  };

  const withConn = async <T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> => {
    await ensure();
    const c = await pool.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  };

  return {
    schema,
    pool,
    ensure,
    q: (sql, params = []) => withConn(async (c) => (await c.query(sql, params)).rows),
    one: (sql, params = []) => withConn(async (c) => (await c.query(sql, params)).rows[0] ?? null),
    run: (sql, params = []) =>
      withConn(async (c) => {
        const r = await c.query(sql, params);
        return { rowCount: r.rowCount, rows: r.rows };
      }),
    tx: (fn) =>
      withConn(async (c) => {
        await c.query("BEGIN");
        try {
          const out = await fn(c);
          await c.query("COMMIT");
          return out;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        }
      }),
  };
}
