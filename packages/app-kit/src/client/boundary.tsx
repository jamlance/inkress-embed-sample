// Reauth boundary helper — the isomorphic half of the "auth redirect must break
// out of the iframe" problem. When a loader throws the kit's reauth signal
// (401 X-Bv-Reauthenticate), recover by re-bootstrapping via app-bridge and
// revalidating, instead of white-screening. CLIENT-SAFE (react-router hooks only).

import { useEffect } from "react";
import { isRouteErrorResponse, useRevalidator, useRouteError } from "react-router";
import { reauthenticate } from "./bridge";

/**
 * Call inside a route's `ErrorBoundary`. Returns true while it's handling a
 * reauth (render a "Reconnecting…" state); false for any other error (let the
 * app render its normal error UI). Example:
 *
 *   export function ErrorBoundary() {
 *     if (useReauthHandler()) return <p>Reconnecting…</p>;
 *     return <GenericError />;
 *   }
 */
export function useReauthHandler(bootstrapPath?: string): boolean {
  const error = useRouteError();
  const revalidator = useRevalidator();
  // Works even though this boundary renders OUTSIDE <BvProvider>: reauth is a
  // standalone function over the shared app-bridge, not a context hook.
  const isReauth = isRouteErrorResponse(error) && error.status === 401;

  useEffect(() => {
    if (!isReauth) return;
    let active = true;
    void (async () => {
      const ok = await reauthenticate(bootstrapPath);
      if (active && ok) revalidator.revalidate();
      else if (active) window.location.reload(); // last resort
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReauth]);

  return isReauth;
}
