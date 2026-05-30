/**
 * Shared bootstrap glue every app's main.ts imports.
 *
 * Reads the session JWT from the URL (the SDK does its own URL-scrub
 * later, so we don't fight it), POSTs to /__bv/bootstrap so the
 * server can exchange the JWT for an inka_ access token under a
 * cookie, then initialises the @inkress/app-bridge SDK so the
 * iframe ↔ host postMessage bridge is live.
 *
 * Returns the SDK instance + the server-side merchant context.
 *
 * Apps that need a thicker UX layer (toasts, modals) build on top of
 * this; v1 keeps it skinny.
 */

import { createInkressApp, type InkressApp } from "@inkress/app-bridge";

export interface BvSession {
  inkress: InkressApp;
  merchant: { id: number; username: string | null; name: string | null; currency_code: string | null };
  /** Scopes the merchant consented to for THIS app. */
  scopes: string[];
}

export interface BvToastFn {
  (message: string, kind?: "success" | "error" | "info" | "warning"): void;
}

export async function initBv(): Promise<BvSession> {
  // Grab the session JWT BEFORE the SDK scrubs it from the URL.
  const sessionJwt = new URLSearchParams(window.location.search).get(
    "inkress_session",
  );

  // Start the bridge (this also scrubs inkress_session from window.location).
  const inkress = await createInkressApp();

  // If we have a session JWT, send it to our own server so it can
  // exchange for an inka_ access token and stash under a cookie.
  let merchantData: BvSession["merchant"] = {
    id: inkress.merchant.id,
    username: inkress.merchant.username,
    name: inkress.merchant.name,
    currency_code: inkress.merchant.currency_code,
  };
  let scopes = inkress.scopes;

  if (sessionJwt) {
    try {
      const r = await fetch("/__bv/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionJwt }),
        credentials: "same-origin",
      });
      if (r.ok) {
        const body = await r.json();
        if (body?.merchant) {
          merchantData = {
            id: body.merchant.id ?? merchantData.id,
            username: body.merchant.username ?? merchantData.username,
            name: body.merchant.name ?? merchantData.name,
            currency_code:
              body.merchant.currency_code ?? merchantData.currency_code,
          };
        }
        if (Array.isArray(body?.scopes)) scopes = body.scopes;
      } else {
        inkress.notify({
          kind: "error",
          message: "Couldn't establish a server session — read-only mode.",
        });
      }
    } catch (err) {
      console.warn("[bv-init] bootstrap failed", err);
    }
  }

  return { inkress, merchant: merchantData, scopes };
}

/** Pop a host-rendered toast. Thin wrapper around inkress.notify. */
export function makeToast(inkress: InkressApp): BvToastFn {
  return (message, kind = "info") => inkress.notify({ kind, message });
}

/** Authenticated fetch against our own server (cookie travels). Wraps
 *  the common "/api/..." pattern with JSON + error normalisation. */
export async function bvApi<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Accept: "application/json",
      ...(init.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    credentials: "same-origin",
  });
  let body: any;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  if (!r.ok) {
    const msg = body?.error || body?.message || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return body as T;
}
