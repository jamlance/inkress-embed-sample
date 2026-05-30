import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { exchangeSessionToken, inkressApi, InkressApiError } from "./inkress-api.mjs";
import { SessionStore, SESSION_COOKIE } from "./session-store.mjs";

const DEFAULT_FRAME_ANCESTORS =
  "https://merchant.inkress.com https://dev.inkress.com https://dev.commerce.webapps.host https://*.commerce.webapps.host";

export function mountAppCore(app, opts) {
  const sessions = new SessionStore();
  const frameAncestors = opts.frameAncestors || DEFAULT_FRAME_ANCESTORS;
  const cfg = {
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    apiBaseUrl: opts.apiBaseUrl,
  };

  app.use(cookieParser());
  app.use(express.json({ limit: "256kb" }));

  app.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "clipboard-write=(self)");
    next();
  });

  app.post("/__bv/bootstrap", async (req, res) => {
    const sessionJwt = typeof req.body?.sessionJwt === "string" ? req.body.sessionJwt.trim() : "";
    if (!sessionJwt) {
      return res.status(400).json({ error: "missing_session_jwt" });
    }
    try {
      const token = await exchangeSessionToken(cfg, sessionJwt);
      const entry = sessions.put(token);
      if (opts.preloadMerchant !== false && entry.merchantId > 0) {
        try {
          const r = await inkressApi(cfg, entry.accessToken, `merchants/${entry.merchantId}`);
          entry.data.merchant = r?.result ?? null;
        } catch {
          /* ignore */
        }
      }
      res.cookie(SESSION_COOKIE, entry.sessionId, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 1000 * 60 * 60 * 24,
        path: "/",
      });
      res.json({
        ok: true,
        merchant: entry.data.merchant ?? null,
        merchant_id: entry.merchantId,
        scopes: entry.scope,
        expires_at: entry.expiresAt,
      });
    } catch (err) {
      const code = err instanceof InkressApiError ? err.code : "exchange_failed";
      const message = err instanceof Error ? err.message : "Token exchange failed";
      res.status(401).json({ error: code, message });
    }
  });

  app.post("/__bv/logout", (req, res) => {
    sessions.delete(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  app.get("/__bv/me", (req, res) => {
    const entry = sessions.get(req.cookies?.[SESSION_COOKIE]);
    if (!entry) return res.status(401).json({ error: "no_session" });
    res.json({
      merchant: entry.data.merchant ?? null,
      merchant_id: entry.merchantId,
      scopes: entry.scope,
      expires_at: entry.expiresAt,
    });
  });

  const requireSession = (req, res, next) => {
    const entry = sessions.get(req.cookies?.[SESSION_COOKIE]);
    if (!entry) return res.status(401).json({ error: "no_session" });
    req.session = entry;
    next();
  };

  app.use(express.static(opts.staticDir, { extensions: ["html"] }));

  return {
    sessions,
    requireSession,
    callInkress: (session, pathPart, init) => inkressApi(cfg, session.accessToken, pathPart, init),
    cfg,
    mountSpaFallback: () => {
      app.get("*", (_req, res) => {
        res.sendFile(path.join(opts.staticDir, "index.html"));
      });
    },
  };
}

// Re-exports so callers can import the API helpers via the same module.
export { exchangeSessionToken, inkressApi, InkressApiError } from "./inkress-api.mjs";
export { SessionStore, SESSION_COOKIE } from "./session-store.mjs";
