// Inbound webhook handling — SERVER ONLY.
//
// An Express handler (mounted with express.raw BEFORE the RR7 handler so the
// exact bytes survive for HMAC and the React render path is bypassed). Verifies
// the signature via admin-sdk WebhookUtils, dedupes via storage, and hands the
// app a typed event with a lazily-built admin client that acts AS the merchant
// (using the offline refresh token — no live session at webhook time).

import crypto from "node:crypto";
import { InkressSDK, type WebhookPayload } from "@inkress/admin-sdk";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import type { AppKit } from "./types";

// Inkress webhook signature: base64(HMAC-SHA256(secret, rawBody)), sent in
// X-Inkress-Webhook-Signature. Matches admin-sdk's documented format (and the
// existing apps). Implemented here because the SDK's WebhookUtils class isn't
// part of the package's public exports — only its payload TYPES are.
function verifySignature(raw: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface WebhookEvent {
  /** Stable delivery id (from header or payload) — used for idempotency. */
  id: string;
  /** Event topic, e.g. "order_paid" (payload.event.action). */
  topic: string;
  merchantId: number;
  payload: WebhookPayload;
  raw: string;
  /** Admin SDK acting AS the merchant. Requires offline tokens to be configured. */
  admin(): Promise<InkressSDK>;
}

export type WebhookHandler = (event: WebhookEvent) => Promise<void> | void;

type ExpressRequestHandler = (req: ExpressRequest, res: ExpressResponse) => void;

/** Build the Express handler. Mount it as:
 *  `app.post(path, express.raw({ type: "*\/*" }), handler)` — createInkressServer
 *  does this for you when you pass `webhook`. */
export function createWebhookHandler(appKit: AppKit, onEvent: WebhookHandler): ExpressRequestHandler {
  const secret = appKit.config.webhookSecret;

  return (req, res) => {
    if (!secret) {
      res.status(503).json({ error: "webhooks_not_configured" });
      return;
    }
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
    const signature = String(req.get("x-inkress-webhook-signature") || "");
    if (!verifySignature(raw, signature, secret)) {
      res.status(401).json({ error: "bad_signature" });
      return;
    }

    // Ack immediately (Inkress retries on non-2xx; we don't want to time out
    // while processing), then process out of band.
    res.json({ received: true });

    void (async () => {
      let payload: WebhookPayload;
      try {
        payload = JSON.parse(raw) as WebhookPayload;
      } catch {
        return;
      }
      const event = (payload as { event?: { action?: string } }).event;
      const topic = event?.action || "unknown";
      const merchantId =
        Number(req.params?.merchantId) ||
        Number((payload as { merchant_id?: number }).merchant_id) ||
        0;
      const id = String(req.get("x-inkress-webhook-id") || payload.id || `${topic}.${payload.timestamp ?? ""}`);

      // Idempotency: skip duplicate deliveries.
      if (appKit.storage && (await appKit.storage.isDuplicateWebhook(id))) return;

      const evt: WebhookEvent = {
        id,
        topic,
        merchantId,
        payload,
        raw,
        async admin() {
          if (!appKit.tokens) throw new Error("offline tokens not configured — cannot act as merchant");
          const accessToken = await appKit.tokens.accessTokenFor(merchantId);
          return new InkressSDK({ accessToken, mode: appKit.config.mode });
        },
      };

      try {
        await onEvent(evt);
      } catch (err) {
        console.error(`[app-kit] webhook handler failed (${topic}):`, (err as Error)?.message);
      }
    })();
  };
}
