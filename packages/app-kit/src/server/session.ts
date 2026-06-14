// ONLINE session storage — SERVER ONLY.
//
// Holds the per-request merchant access token (tied to the acting dashboard
// user, short-lived). Two impls behind one interface (Shopify's SessionStorage
// model): MemorySessionStorage for dev, PgSessionStorage for prod (survives
// redeploys; tokens encrypted at rest). Kept separate from app data and from the
// OFFLINE refresh-token store (./tokens).
//
// Contract is uniform "mutate-then-save": load() → mutate fields (e.g. refreshed
// accessToken, data.merchant) → save(). Memory returns a live ref so save() is a
// formality; Pg requires it. Callers (the request glue) always call save().

import crypto from "node:crypto";
import type { TokenResponse } from "./inkress-api";
import type { SchemaPg } from "./pg";
import { encrypt, decrypt, type EncryptionKey } from "./crypto";

export interface Session {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  scope: string[];
  merchantId: number;
  /** Epoch seconds; the access token is considered dead after this. */
  expiresAt: number;
  /** App-attached context: merchant profile, acting user id, etc. */
  data: Record<string, unknown>;
}

export interface SessionStorage {
  create(token: TokenResponse): Promise<Session>;
  load(id: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  destroy(id: string): Promise<void>;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** Build a Session from a fresh token response (shared by both impls). */
export function sessionFromToken(token: TokenResponse): Session {
  return {
    id: crypto.randomUUID(),
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    scope: (token.scope || "").split(" ").filter(Boolean),
    merchantId: token.merchant_id ?? 0,
    // 60s of slack so we refresh before the API would reject.
    expiresAt: nowSec() + Math.max(60, (Number(token.expires_in) || 3600) - 60),
    data: {},
  };
}

// ---- in-memory (dev / single instance) -------------------------------------

export class MemorySessionStorage implements SessionStorage {
  private map = new Map<string, Session>();

  constructor(opts: { sweepEverySec?: number } = {}) {
    const sweep = setInterval(() => this.sweep(), (opts.sweepEverySec ?? 60) * 1000);
    sweep.unref?.();
  }

  create(token: TokenResponse): Promise<Session> {
    const s = sessionFromToken(token);
    this.map.set(s.id, s);
    return Promise.resolve(s);
  }
  load(id: string): Promise<Session | null> {
    if (!id) return Promise.resolve(null);
    const s = this.map.get(id);
    if (!s) return Promise.resolve(null);
    if (s.expiresAt < nowSec()) {
      this.map.delete(id);
      return Promise.resolve(null);
    }
    return Promise.resolve(s);
  }
  save(session: Session): Promise<void> {
    this.map.set(session.id, session);
    return Promise.resolve();
  }
  destroy(id: string): Promise<void> {
    if (id) this.map.delete(id);
    return Promise.resolve();
  }
  private sweep() {
    const now = nowSec();
    for (const [id, s] of this.map) if (s.expiresAt < now) this.map.delete(id);
  }
}

// ---- Postgres-backed (prod; survives redeploys) ----------------------------

export const KIT_SESSION_DDL = `
  CREATE TABLE IF NOT EXISTS bv_sessions (
    id           TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    scope        TEXT NOT NULL DEFAULT '',
    merchant_id  BIGINT NOT NULL DEFAULT 0,
    expires_at   BIGINT NOT NULL,
    data         JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_bv_sessions_expires ON bv_sessions (expires_at);
`;

export class PgSessionStorage implements SessionStorage {
  private db: SchemaPg;
  private key: EncryptionKey | null;

  /** @param key when set, access/refresh tokens are AES-256-GCM encrypted at rest. */
  constructor(db: SchemaPg, opts: { encryptionKey?: EncryptionKey } = {}) {
    this.db = db;
    this.key = opts.encryptionKey ?? null;
  }

  private enc(v: string | null): string | null {
    if (v == null) return null;
    return this.key ? encrypt(v, this.key) : v;
  }
  private dec(v: string | null): string | null {
    if (v == null) return null;
    if (!this.key) return v;
    try {
      return decrypt(v, this.key);
    } catch {
      return null; // key rotated / corrupt → treat as no token (forces rebootstrap)
    }
  }

  async create(token: TokenResponse): Promise<Session> {
    const s = sessionFromToken(token);
    await this.save(s);
    return s;
  }

  async load(id: string): Promise<Session | null> {
    if (!id) return null;
    const row = await this.db.one(
      `SELECT id, access_token, refresh_token, scope, merchant_id, expires_at, data FROM bv_sessions WHERE id=$1`,
      [id],
    );
    if (!row) return null;
    if (Number(row.expires_at) < nowSec()) {
      await this.destroy(id);
      return null;
    }
    const accessToken = this.dec(row.access_token);
    if (accessToken == null) {
      await this.destroy(id);
      return null;
    }
    return {
      id: row.id,
      accessToken,
      refreshToken: this.dec(row.refresh_token),
      scope: String(row.scope || "").split(" ").filter(Boolean),
      merchantId: Number(row.merchant_id) || 0,
      expiresAt: Number(row.expires_at),
      data: row.data || {},
    };
  }

  async save(session: Session): Promise<void> {
    await this.db.run(
      `INSERT INTO bv_sessions (id, access_token, refresh_token, scope, merchant_id, expires_at, data, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (id) DO UPDATE SET
         access_token=$2, refresh_token=$3, scope=$4, merchant_id=$5, expires_at=$6, data=$7, updated_at=now()`,
      [
        session.id,
        this.enc(session.accessToken),
        this.enc(session.refreshToken),
        session.scope.join(" "),
        session.merchantId,
        session.expiresAt,
        JSON.stringify(session.data ?? {}),
      ],
    );
  }

  async destroy(id: string): Promise<void> {
    if (!id) return;
    await this.db.run(`DELETE FROM bv_sessions WHERE id=$1`, [id]);
  }
}
