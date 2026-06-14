// Per-request session resolution — SERVER ONLY.
//
// Runs ONCE per request in the Express→RR7 getLoadContext, so loader fan-out
// can't race the refresh. Carrier precedence: X-BV-Session header (primary,
// cross-iframe-safe) → Partitioned cookie (secondary) → ?inkress_session JWT
// (first-load bootstrap only). Token exchange/refresh happen here; the access
// token + client secret never reach the client.

import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import type { Merchant, BvUser } from "../index";
import { exchangeSessionToken, refreshAccessToken, peekAud, peekClaim } from "./inkress-api";
import { buildAdmin } from "./admin";
import type { Session } from "./session";
import type { AppKit, AppKitRequestContext } from "./types";

export const SESSION_COOKIE = "bv_app_session";
const REFRESH_SKEW_SEC = 120; // refresh when within 2 min of expiry
const nowSec = () => Math.floor(Date.now() / 1000);

/** Secondary carrier: SameSite=None + Partitioned (CHIPS) so it survives the
 *  cross-site iframe where the browser still honours partitioned cookies. */
export function setSessionCookie(res: ExpressResponse, sessionId: string): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      partitioned: true,
      path: "/",
      maxAge: 60 * 60 * 24,
    }),
  );
}

function clearSessionCookie(res: ExpressResponse): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, "", { path: "/", maxAge: 0, secure: true, sameSite: "none", partitioned: true }),
  );
}

/** Best-effort merchant preload so loaders have name/username without a round
 *  trip. Failures are non-fatal (the client also has merchant via app-bridge). */
async function preloadMerchant(appKit: AppKit, session: Session): Promise<void> {
  if (!session.merchantId) return;
  try {
    const admin = buildAdmin(session, appKit.config.mode);
    const resp = await admin.merchants.get(session.merchantId);
    if (resp?.result) session.data.merchant = resp.result as unknown as Merchant;
  } catch {
    /* non-fatal */
  }
}

/** Exchange a dashboard session JWT → store a session (+ offline refresh token,
 *  + merchant preload). Shared by first-load bootstrap (resolveContext) and the
 *  client-recovery resource route (POST the JWT when the carrier was lost). */
export async function bootstrapFromJwt(
  appKit: AppKit,
  sessionJwt: string,
  res?: ExpressResponse,
): Promise<Session> {
  const aud = peekAud(sessionJwt);
  const cfg = appKit.cfgFor(aud);
  const token = await exchangeSessionToken(cfg, sessionJwt, { scope: appKit.config.scopes });
  const session = await appKit.sessionStorage.create(token);
  session.data.clientId = cfg.clientId;
  session.data.user_id = peekClaim<number>(sessionJwt, "user_id");
  await preloadMerchant(appKit, session);
  if (appKit.tokens && token.refresh_token) {
    await appKit.tokens.save(session.merchantId, token.refresh_token).catch(() => {});
  }
  await appKit.sessionStorage.save(session);
  if (res) setSessionCookie(res, session.id);
  return session;
}

export async function resolveContext(
  appKit: AppKit,
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<AppKitRequestContext> {
  const cookies = parseCookie(req.headers.cookie || "");
  const headerSid = req.get("x-bv-session") || "";
  const cookieSid = cookies[SESSION_COOKIE] || "";
  const url = new URL(req.originalUrl || req.url, "http://localhost");
  const urlJwt = url.searchParams.get("inkress_session");

  let session: Session | null = null;
  let bootstrap: { sessionId: string } | undefined;

  // 1) Existing session (header primary, cookie secondary).
  const sid = headerSid || cookieSid;
  if (sid) session = await appKit.sessionStorage.load(sid);

  if (!session && urlJwt) {
    // 2) First-load bootstrap: exchange the dashboard session JWT.
    session = await bootstrapFromJwt(appKit, urlJwt, res);
    bootstrap = { sessionId: session.id };
  } else if (session && session.refreshToken && session.expiresAt < nowSec() + REFRESH_SKEW_SEC) {
    // 3) Refresh near-expiry (once per request → no fan-out stampede).
    try {
      const cfg = appKit.cfgFor((session.data.clientId as string) || appKit.config.clientId);
      const t = await refreshAccessToken(cfg, session.refreshToken);
      session.accessToken = t.access_token;
      if (t.refresh_token) session.refreshToken = t.refresh_token;
      if (t.scope) session.scope = t.scope.split(" ").filter(Boolean);
      session.expiresAt = nowSec() + Math.max(60, (Number(t.expires_in) || 3600) - 60);
      await appKit.sessionStorage.save(session);
      if (appKit.tokens && t.refresh_token) {
        await appKit.tokens.save(session.merchantId, t.refresh_token).catch(() => {});
      }
    } catch {
      // Refresh failed → drop the session so authenticate forces a re-bootstrap.
      await appKit.sessionStorage.destroy(session.id).catch(() => {});
      clearSessionCookie(res);
      session = null;
    }
  }

  const user: BvUser = {
    id: Number(req.get("x-bv-user-id")) || (session?.data.user_id as number) || null,
    name: req.get("x-bv-user-name") || null,
  };
  const merchant: Merchant | null =
    (session?.data.merchant as Merchant | undefined) ?? (session ? { id: session.merchantId } : null);

  return { appKit, session, merchant, user, scopes: session?.scope ?? [], bootstrap };
}
