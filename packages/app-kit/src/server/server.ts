// createInkressServer — the Express ↔ React Router v7 glue. SERVER ONLY.
//
// Enforces the mount order an embedded app needs:
//   CSP/framing headers → webhook (raw body, before RR7) → static assets →
//   RR7 request handler with getLoadContext (session resolved once/request).
// Deliberately installs NO global body parser, so RR7 reads action bodies itself.

import path from "node:path";
import express, { type Express, type RequestHandler } from "express";
import { createRequestHandler } from "@react-router/express";
import type { AppLoadContext, ServerBuild } from "react-router";
import { cspHeaders } from "./env";
import { resolveContext } from "./context";
import type { AppKit } from "./types";

/** Minimal shape of a Vite dev server in middleware mode (dev only). */
export interface ViteDevServerLike {
  middlewares: RequestHandler;
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

export interface CreateServerOptions {
  appKit: AppKit;
  /** Production: the SSR build (`import * as build from "./build/server/index.js"`). */
  build?: ServerBuild | (() => Promise<ServerBuild>);
  /** Production static client dir (default "build/client"). */
  clientDir?: string;
  /** Dev only: a Vite dev server in middleware mode (build is loaded from it). */
  viteDevServer?: ViteDevServerLike;
  /** Optional inbound webhook route (raw body + HMAC handled by createWebhookHandler). */
  webhook?: { path: string; handler: RequestHandler };
  /** Extra Express middleware mounted AFTER the webhook and BEFORE static/RR7
   *  (e.g. custom-domain host rewriting). Each runs on every request. */
  middleware?: RequestHandler[];
  mode?: "production" | "development";
}

export function createInkressServer(opts: CreateServerOptions): Express {
  const { appKit } = opts;
  const app = express();
  app.disable("x-powered-by");

  // 1) CSP / framing on every response (mandatory for the dashboard iframe).
  const csp = cspHeaders(appKit.config.frameAncestors);
  app.use((_req, res, next) => {
    for (const [k, v] of Object.entries(csp)) res.setHeader(k, v);
    next();
  });

  // 2) Webhook FIRST — raw body, bypasses the React render path.
  if (opts.webhook) {
    app.post(opts.webhook.path, express.raw({ type: "*/*", limit: "1mb" }), opts.webhook.handler);
  }

  // 2b) App-provided middleware (e.g. custom-domain host rewriting).
  for (const mw of opts.middleware ?? []) app.use(mw);

  // 3) Static assets (prod) or Vite middleware (dev).
  let build: ServerBuild | (() => Promise<ServerBuild>);
  if (opts.viteDevServer) {
    app.use(opts.viteDevServer.middlewares);
    build = () =>
      opts.viteDevServer!.ssrLoadModule("virtual:react-router/server-build") as unknown as Promise<ServerBuild>;
  } else {
    const clientDir = opts.clientDir || "build/client";
    app.use("/assets", express.static(path.join(clientDir, "assets"), { immutable: true, maxAge: "1y" }));
    app.use(express.static(clientDir, { maxAge: "1h" }));
    if (!opts.build) {
      throw new Error("createInkressServer: `build` is required in production (or pass `viteDevServer` for dev)");
    }
    build = opts.build;
  }

  // 4) RR7 — session resolved once per request in getLoadContext.
  app.all(
    "*",
    createRequestHandler({
      build,
      mode: opts.mode || (process.env.NODE_ENV as "production" | "development" | undefined),
      // RR7's default AppLoadContext carries an index signature; our concrete
      // context is assigned at runtime and the app augments AppLoadContext to it.
      getLoadContext: (req, res) => resolveContext(appKit, req, res) as unknown as Promise<AppLoadContext>,
    }),
  );

  return app;
}
