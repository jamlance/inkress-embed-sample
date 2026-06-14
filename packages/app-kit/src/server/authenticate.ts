// authenticate.* — the ergonomic auth surface (Shopify's authenticate.admin model).
// SERVER ONLY. One call in a loader/action returns the authenticated admin SDK.

import { redirect } from "react-router";
import type { Scope } from "../index";
import { buildAdmin } from "./admin";
import type { AppKitRequestContext, MerchantContext } from "./types";

export interface AppKitArgs {
  request: Request;
  /** Resolved by getLoadContext; type it via the app's AppLoadContext augmentation. */
  context: AppKitRequestContext;
}

function toMerchantContext(ctx: AppKitRequestContext): MerchantContext | null {
  if (!ctx.session) return null;
  const username = (ctx.merchant?.username as string | undefined) ?? undefined;
  return {
    admin: buildAdmin(ctx.session, ctx.appKit.config.mode, username),
    merchant: ctx.merchant ?? { id: ctx.session.merchantId },
    merchantId: ctx.session.merchantId,
    scopes: ctx.scopes,
    user: ctx.user,
    session: ctx.session,
  };
}

/** Standalone OAuth authorize URL. Embedded apps never hit this. */
function authorizeRedirect(ctx: AppKitRequestContext, request: Request): Response {
  const { config } = ctx.appKit;
  const origin = config.publicBaseUrl || new URL(request.url).origin;
  const authorize = new URL(`${config.apiBaseUrl.replace(/\/$/, "")}/oauth/authorize`);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", `${origin}/oauth/callback`);
  authorize.searchParams.set("response_type", "code");
  if (config.scopes?.length) authorize.searchParams.set("scope", config.scopes.join(" "));
  return redirect(authorize.toString());
}

/** Embedded re-bootstrap signal: no server-side JWT to exchange, so tell the
 *  client (app-bridge / BvProvider) to re-issue a session token and retry. */
function reauthenticate(): Response {
  return new Response("reauthenticate", {
    status: 401,
    headers: { "X-Bv-Reauthenticate": "1" },
  });
}

export const authenticate = {
  /** Require an authenticated merchant. Throws a redirect (standalone) or a
   *  re-bootstrap 401 (embedded) when there's no live session. */
  merchant(args: AppKitArgs): MerchantContext {
    const mc = toMerchantContext(args.context);
    if (!mc) {
      throw args.context.appKit.config.standalone
        ? authorizeRedirect(args.context, args.request)
        : reauthenticate();
    }
    return mc;
  },

  /** Like merchant() but returns null instead of throwing (public/optional routes). */
  optionalMerchant(args: AppKitArgs): MerchantContext | null {
    return toMerchantContext(args.context);
  },
};

/** Alias — reads clearer in Inkress domain code. */
export const requireMerchant = authenticate.merchant;
export const getOptionalMerchant = authenticate.optionalMerchant;

/** Guard a route/action on a scope. Throws 403 when missing. */
export function assertScope(scopes: Scope[], scope: Scope): void {
  if (!scopes.includes(scope)) {
    throw new Response(`Missing required scope: ${scope}`, { status: 403 });
  }
}
