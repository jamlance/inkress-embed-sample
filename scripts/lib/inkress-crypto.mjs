/**
 * Node-side replicas of two Elixir crypto primitives in commerce-api:
 *
 *   1. `Api.Auth.OauthClient.hash_secret/1` — HMAC-SHA256 with the
 *      server pepper (`SECRET_KEY_BASE` fallback), hex-encoded.
 *
 *   2. `Utils.Encryption.encrypt/1` — AES-256-GCM with the hardcoded
 *      @key + ad "default:text_encryption", emitted as
 *      base64url(iv ‖ ciphertext ‖ tag) per ExCrypto.encode_payload.
 *
 * Used by the bulk-register script so each app's `client_secret` and
 * `webhook_secret` round-trip through the same logic the API uses,
 * without touching the running Elixir VM.
 */

import crypto from "node:crypto";

const ENCRYPTION_KEY_B64 = "BXSb9Qu1JL4+RAIwkiyPhHli8DMIXfX+a2WWQlh2fjk=";
const AAD = Buffer.from("default:text_encryption", "utf8");
const IV_LEN = 16; // matches ExCrypto's standard 16-byte IV
const TAG_LEN = 16;

export function hashOauthClientSecret(rawSecret, pepper) {
  if (!pepper || pepper.length < 32) {
    throw new Error("OauthClient pepper missing or too short (<32 bytes)");
  }
  return crypto
    .createHmac("sha256", pepper)
    .update(rawSecret, "utf8")
    .digest("hex");
}

export function encryptUtilsEncryption(plaintext) {
  const key = Buffer.from(ENCRYPTION_KEY_B64, "base64");
  if (key.length !== 32) throw new Error("encryption key not 32 bytes");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_LEN,
  });
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, ct, tag]);
  return base64UrlEncode(payload);
}

export function decryptUtilsEncryption(payloadB64) {
  const key = Buffer.from(ENCRYPTION_KEY_B64, "base64");
  const buf = base64UrlDecode(payloadB64);
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("payload too short");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_LEN,
  });
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function genClientId() {
  return "inkid_" + base64UrlEncode(crypto.randomBytes(16));
}

export function genClientSecret() {
  // Matches Api.Auth.OauthClient.generate_secret/0 — 32 bytes base64url, no padding.
  return base64UrlEncode(crypto.randomBytes(32));
}

export function genWebhookSecret() {
  // Matches `whsec_` + 32 random bytes base64url, no padding, per put_webhook_secret/1.
  return "whsec_" + base64UrlEncode(crypto.randomBytes(32));
}

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(
    s.replace(/-/g, "+").replace(/_/g, "/") + pad,
    "base64",
  );
}
