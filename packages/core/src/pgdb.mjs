// Shared Postgres helper. All apps connect to one database
// (`bookerva_apps`) but each gets its OWN schema, so tables never
// collide and data survives redeploys (unlike the old per-container
// SQLite). Async API.
//
//   const db = await openPg("promo_codes", `
//     CREATE TABLE IF NOT EXISTS codes ( ... );
//   `);
//   const rows = await db.q("SELECT * FROM codes WHERE merchant_id=$1", [mid]);
//   const row  = await db.one("SELECT * FROM codes WHERE id=$1", [id]);
//   await db.run("INSERT INTO codes (...) VALUES (...)", [...]);

import pg from "pg";

let pool = null;
function getPool() {
  if (!pool) {
    const connectionString = process.env.APPS_DATABASE_URL;
    if (!connectionString) {
      throw new Error("APPS_DATABASE_URL is not set — the app needs a Postgres connection string.");
    }
    pool = new pg.Pool({ connectionString, max: 6, idleTimeoutMillis: 30000 });
    pool.on("error", (e) => console.error("[pgdb] pool error", e.message));
  }
  return pool;
}

function safeSchema(name) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!s || /^[0-9]/.test(s)) return `app_${s}`;
  return s;
}

export async function openPg(appName, schemaSql) {
  const schema = safeSchema(appName);
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  } finally {
    client.release();
  }

  // Run the app's DDL with search_path pinned to its schema.
  const withSchema = async (fn) => {
    const c = await p.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      return await fn(c);
    } finally {
      c.release();
    }
  };
  if (schemaSql) {
    await withSchema((c) => c.query(schemaSql));
  }

  return {
    schema,
    async q(sql, params = []) {
      return withSchema(async (c) => (await c.query(sql, params)).rows);
    },
    async one(sql, params = []) {
      return withSchema(async (c) => (await c.query(sql, params)).rows[0] || null);
    },
    async run(sql, params = []) {
      return withSchema(async (c) => {
        const r = await c.query(sql, params);
        return { rowCount: r.rowCount, rows: r.rows };
      });
    },
    /** Run several statements in one transaction with the schema pinned. */
    async tx(fn) {
      const c = await p.connect();
      try {
        await c.query(`SET search_path TO "${schema}"`);
        await c.query("BEGIN");
        const out = await fn(c);
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  };
}
