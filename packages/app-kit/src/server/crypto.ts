// AES-256-GCM at-rest encryption — SERVER ONLY.
//
// Ported from packages/core/src/merchant-tokens.mjs. The key is derived from the
// app's OAuth client secret (SHA-256), so tokens persisted in our DB are useless
// without the deployed secret. Used for both the OFFLINE refresh-token store and
// the (optional) encryption of ONLINE session tokens in the PG session store.

import crypto from "node:crypto";

export type EncryptionKey = Buffer;

export const keyFromSecret = (secret: string): EncryptionKey =>
  crypto.createHash("sha256").update(String(secret || "")).digest();

export function encrypt(text: string, key: EncryptionKey): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decrypt(b64: string, key: EncryptionKey): string {
  const buf = Buffer.from(b64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
