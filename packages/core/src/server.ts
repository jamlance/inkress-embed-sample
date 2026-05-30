/**
 * Express helpers every app uses to mount the standard handshake +
 * authenticated API proxy.
 *
 *   const app = express();
 *   const { sessions, requireSession } = mountAppCore(app, {
 *     clientId: process.env.OAUTH_CLIENT_ID!,
 *     clientSecret: process.env.OAUTH_CLIENT_SECRET!,
 *     apiBaseUrl: process.env.INKRESS_API_BASE!,
 *     frameAncestors: process.env.FRAME_ANCESTORS,
 *     staticDir: path.join(__dirname, "../dist"),
 *   });
 *
 * Mounts these routes:
 *
 *   POST /__bv/bootstrap         body { sessionJwt } → cookie + identity
 *   POST /__bv/logout            clear cookie
 *   GET  /__bv/me                cached identity for the cookie
 *
 *   POST /api/* and GET /api/* with the bv_app_session cookie are
 *   middleware-checked: requireSession populates req.session before
 *   the app's own handlers run.
 *
 * Plus the static dist at "/" and the embed-friendly headers.
 */

import path from "node:path";
import type { Request, Response, NextFunction, Express } from "express";
import express from "express";
import cookieParser from "cookie-parser";
import {
  exchangeSessionToken,
  inkressApi,
  InkressApiError,
  type InkressClientConfig,
} from "./inkress-api.js";
import { SessionStore, SESSION_COOKIE, type SessionEntry } from "./session-store.js";

export interface AppCoreOptions extends InkressClientConfig {
  /** CSP frame-ancestors for the embed pages. Defaults to a sensible
   *  list including Inkress dev + prod. */
  frameAncestors?: string;
  /** Directory containing the built Vite output to serve as the SPA. */
  staticDir: string;
  /** Optional: pre-fetch the merchant when a session is created so
   *  apps don't all reimplement that. Defaults to true. */
  preloadMerchant?: boolean;
}

export interface RequestWithSession extends Request {
  session?: SessionEntry;
}

const DEFAULT_FRAME_ANCESTORS =
  "https://merchant.inkress.com https://dev.inkress.com https://dev.commerce.webapps.host https://*.commerce.webapps.host";

export function mountAppCore(app: Express, opts: AppCoreOptions) {
  const sessions = new SessionStore();
  const frameAncestors = opts.frameAncestors || DEFAULT_FRAME_ANCESTORS;
  const cfg: InkressClientConfig = {
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    apiBaseUrl: opts.apiBaseUrl,
  };

  app.use(cookieParser());
  app.use(express.json({ limit: "256kb" }));

  // Embed-friendly headers on every response.
  app.use((_req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      `frame-ancestors ${frameAncestors}`,
    );
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "clipboard-write=(self)");
    next();
  });

  // -------- Bootstrap --------
  // Browser passes session JWT (just unwrapped from inkress_session)
  // and we exchange server-side; cookie is HttpOnly + Secure + SameSite=None.
  app.post("/__bv/bootstrap", async (req, res) => {
    const sessionJwt =
      typeof req.body?.sessionJwt === "string" ? req.body.sessionJwt.trim() : "";
    if (!sessionJwt) {
      return res.status(400).json({ error: "missing_session_jwt" });
    }
    try {
      const token = await exchangeSessionToken(cfg, sessionJwt);
      const entry = sessions.put(token);
      if (opts.preloadMerchant !== false) {
        // Best-effort: stash basic identity. Apps can refresh later.
        try {
          const merchantId = entry.merchantId;
          if (merchantId > 0) {
            const r = await inkressApi<{ result: any }>(
              cfg,
              entry.accessToken,
              `merchants/${merchantId}`,
            );
            entry.data.merchant = r?.result ?? null;
          }
        } catch {
          /* ignore — apps can fetch later */
        }
      }
      res.cookie(SESSION_COOKIE, entry.sessionId, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 1000 * 60 * 60 * 24, // 24h soft cap
        path: "/",
      });
      res.json({
        ok: true,
        merchant: entry.data.merchant ?? null,
        merchant_id: entry.merchantId,
        scopes: entry.scope,
        expires_at: entry.expiresAt,
      });
    } catch (err: any) {
      const code = err instanceof InkressApiError ? err.code : "exchange_failed";
      const message =
        err instanceof Error ? err.message : "Token exchange failed";
      res.status(401).json({ error: code, message });
    }
  });

  app.post("/__bv/logout", (req, res) => {
    sessions.delete(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  app.get("/__bv/me", (req: RequestWithSession, res) => {
    const entry = sessions.get(req.cookies?.[SESSION_COOKIE]);
    if (!entry) return res.status(401).json({ error: "no_session" });
    res.json({
      merchant: entry.data.merchant ?? null,
      merchant_id: entry.merchantId,
      scopes: entry.scope,
      expires_at: entry.expiresAt,
    });
  });

  const requireSession = (
    req: RequestWithSession,
    res: Response,
    next: NextFunction,
  ) => {
    const entry = sessions.get(req.cookies?.[SESSION_COOKIE]);
    if (!entry) {
      return res.status(401).json({ error: "no_session" });
    }
    req.session = entry;
    next();
  };

  // Static SPA. Any unmatched route falls through to index.html so
  // client-side routing works (back button, deep links).
  app.use(express.static(opts.staticDir, { extensions: ["html"] }));

  return {
    sessions,
    requireSession,
    /** Convenience to call the Inkress API with the current session's token. */
    callInkress: async <T = any>(
      session: SessionEntry,
      pathPart: string,
      init?: RequestInit,
    ) => inkressApi<T>(cfg, session.accessToken, pathPart, init),
    cfg,
    /** Mount SPA fallback. Call AFTER the app's own /api/* handlers
     *  are mounted so they take precedence. */
    mountSpaFallback: () => {
      app.get("*", (_req, res) => {
        res.sendFile(path.join(opts.staticDir, "index.html"));
      });
    },
  };
}
