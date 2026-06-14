// useStorefront — a memoized client for @inkress/storefront-sdk payment-URL
// generation. CLIENT-SAFE.
//
// We expose our own StorefrontClient interface (not the SDK's class type) so
// consumers don't resolve storefront-sdk's broken types, AND we resolve the SDK
// constructor defensively: storefront-sdk v0.0.1's package entry double-wraps its
// default export, so `import Inkress` can land on the module object (not the
// class) and `new Inkress()` throws. We unwrap to the real ctor, and fall back to
// a built-in URL builder (identical scheme) if the SDK can't be constructed —
// so render never crashes.

import { useMemo } from "react";
import * as StorefrontSDK from "@inkress/storefront-sdk";
import type { InkressMode } from "../index";
import { useBv } from "./bv-provider";

export interface PaymentUrlOptions {
  username: string;
  total: number;
  currency_code?: string;
  title?: string;
  reference_id?: string;
  payment_link_id?: string;
  customer?: { first_name?: string; last_name?: string; email?: string; phone?: string };
}

export interface StorefrontClient {
  createPaymentUrl(options: PaymentUrlOptions): string;
  generateRandomId(): string;
}

/** Walk through the SDK's interop wrappers to the actual constructor function. */
function resolveInkressCtor(): (new (opts?: { mode?: "live" | "test" }) => unknown) | null {
  let m: any = StorefrontSDK;
  for (let i = 0; i < 4 && m && typeof m !== "function"; i++) m = m.default ?? m.Inkress;
  return typeof m === "function" ? m : null;
}

const randomId = () =>
  Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15);

/** Built-in fallback — replicates storefront-sdk's exact payment-URL scheme. */
function fallbackClient(mode: InkressMode): StorefrontClient {
  const base = mode === "sandbox" ? "https://dev.inkress.com" : "https://inkress.com";
  return {
    generateRandomId: randomId,
    createPaymentUrl(opts) {
      if (!opts.username) throw new Error("Merchant username is required");
      const order = {
        total: Number(opts.total),
        currency_code: opts.currency_code || "JMD",
        title: opts.title || `Payment to ${opts.username}`,
        reference_id: opts.reference_id || randomId(),
        customer: { first_name: "", last_name: "", email: "", phone: "", ...(opts.customer || {}) },
      };
      const token = btoa(unescape(encodeURIComponent(JSON.stringify(order))));
      return `${base}/merchants/${encodeURIComponent(opts.username)}/order?link_token=${opts.payment_link_id || ""}&order_token=${token}`;
    },
  };
}

/** A storefront client bound to the app's mode. Call e.g.
 *  `useStorefront().createPaymentUrl({ username, total, title })`. */
export function useStorefront(): StorefrontClient {
  const { mode } = useBv();
  return useMemo(() => {
    const Ctor = resolveInkressCtor();
    if (Ctor) {
      try {
        return new Ctor({ mode: mode === "sandbox" ? "test" : "live" }) as unknown as StorefrontClient;
      } catch {
        /* fall through to the built-in builder */
      }
    }
    return fallbackClient(mode);
  }, [mode]);
}
