// OFFLINE merchant refresh-token store — SERVER ONLY.
//
// Long-lived per-merchant refresh tokens so an app's webhooks / public (no-auth)
// pages can act on a merchant's behalf with no live dashboard session — e.g.
// flip an order to fulfilled on a payment webhook, or create an order when a
// customer buys on a public storefront. Requires the OAuth client to hold
// `offline_access` (so the embedded bootstrap returns a refresh_token).
//
// Ported from packages/core/src/merchant-tokens.mjs: AES-256-GCM at rest,
// short-lived access-token cache, and inflight-dedupe so a loader fan-out can't
// stampede the refresh endpoint.

import type { OAuthClientConfig } from "./inkress-api";
import { refreshAccessToken } from "./inkress-api";
import type { SchemaPg } from "./pg";
import { keyFromSecret, encrypt, decrypt } from "./crypto";

export const KIT_TOKENS_DDL = `
  CREATE TABLE IF NOT EXISTS merchant_tokens (
    merchant_id BIGINT PRIMARY KEY,
    refresh_enc TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

export interface MerchantTokenStore {
  /** Persist a merchant's refresh token (encrypted). Call on bootstrap. */
  save(merchantId: number, refreshToken: string): Promise<boolean>;
  hasToken(merchantId: number): Promise<boolean>;
  /** A fresh, cached access token for the merchant (refreshes as needed). */
  accessTokenFor(merchantId: number): Promise<string>;
  forget(merchantId: number): Promise<void>;
}

export function openMerchantTokens(db: SchemaPg, cfg: OAuthClientConfig): MerchantTokenStore {
  const key = keyFromSecret(cfg.clientSecret);
  const cache = new Map<number, { token: string; exp: number }>();
  const inflight = new Map<number, Promise<string>>();

  return {
    async save(merchantId, refreshToken) {
      if (!merchantId || !refreshToken) return false;
      await db.run(
        `INSERT INTO merchant_tokens (merchant_id, refresh_enc, updated_at) VALUES ($1,$2,now())
         ON CONFLICT (merchant_id) DO UPDATE SET refresh_enc=$2, updated_at=now()`,
        [merchantId, encrypt(refreshToken, key)],
      );
      cache.delete(merchantId);
      return true;
    },

    async hasToken(merchantId) {
      return Boolean(await db.one(`SELECT 1 FROM merchant_tokens WHERE merchant_id=$1`, [merchantId]));
    },

    async forget(merchantId) {
      cache.delete(merchantId);
      await db.run(`DELETE FROM merchant_tokens WHERE merchant_id=$1`, [merchantId]);
    },

    accessTokenFor(merchantId): Promise<string> {
      const c = cache.get(merchantId);
      if (c && c.exp > Date.now() + 30_000) return Promise.resolve(c.token);
      const existing = inflight.get(merchantId);
      if (existing) return existing;

      const p = (async () => {
        const row = await db.one<{ refresh_enc: string }>(
          `SELECT refresh_enc FROM merchant_tokens WHERE merchant_id=$1`,
          [merchantId],
        );
        if (!row) throw new Error("merchant_not_connected");
        const rt = decrypt(row.refresh_enc, key);
        const t = await refreshAccessToken(cfg, rt);
        if (t.refresh_token && t.refresh_token !== rt) {
          await db.run(`UPDATE merchant_tokens SET refresh_enc=$1, updated_at=now() WHERE merchant_id=$2`, [
            encrypt(t.refresh_token, key),
            merchantId,
          ]);
        }
        cache.set(merchantId, {
          token: t.access_token,
          exp: Date.now() + (Number(t.expires_in) || 3600) * 1000,
        });
        return t.access_token;
      })().finally(() => inflight.delete(merchantId));

      inflight.set(merchantId, p);
      return p;
    },
  };
}
