// Custom server: Express ↔ React Router v7, with the Inkress embedded session
// resolved once per request. Dev uses Vite middleware; prod serves the build.
import { createInkressServer } from "@inkress/app-kit/server";
import { appKit, webhookHandler } from "./app/lib/app-kit.server.mjs";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const production = process.env.NODE_ENV === "production";
const webhook = { path: "/webhooks/inkress/:merchantId", handler: webhookHandler };

let app;
if (production) {
  const build = await import("./build/server/index.js");
  app = createInkressServer({ appKit, build, clientDir: "build/client", webhook, mode: "production" });
} else {
  const { createServer } = await import("vite");
  const viteDevServer = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  app = createInkressServer({ appKit, viteDevServer, webhook, mode: "development" });
}

app.listen(PORT, HOST, () => console.log(`[__APP_NAME__] listening on http://${HOST}:${PORT}`));
