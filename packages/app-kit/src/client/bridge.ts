// Single shared app-bridge instance + a provider-independent reauth path.
// CLIENT-SAFE. The bridge is memoized so the provider and the reauth boundary
// (which renders OUTSIDE the provider) share one instance — no double-bridge.

import { createInkressApp, type InkressApp } from "@inkress/app-bridge";
import { setSessionId } from "./session";

let bridgePromise: Promise<InkressApp> | null = null;

export function getBridge(): Promise<InkressApp> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("app-bridge is client-only"));
  }
  if (!bridgePromise) bridgePromise = createInkressApp();
  return bridgePromise;
}

/** Re-mint a server session from a fresh dashboard JWT and stash its id for the
 *  header carrier. Independent of React context so the reauth ErrorBoundary can
 *  call it even when the provider tree didn't render. Returns success. */
export async function reauthenticate(bootstrapPath = "/bv/bootstrap"): Promise<boolean> {
  try {
    const app = await getBridge();
    const token = app.session.current().token;
    const r = await fetch(bootstrapPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionJwt: token }),
    });
    if (!r.ok) return false;
    const j = (await r.json()) as { sessionId?: string };
    if (j?.sessionId) {
      setSessionId(j.sessionId);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
