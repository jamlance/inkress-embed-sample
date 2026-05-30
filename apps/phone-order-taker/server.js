import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const required = ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[phone-order-taker] Missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE,
  frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

// TODO: app-specific API endpoints

core.mountSpaFallback();

app.listen(PORT, HOST, () => {
  console.log(`[phone-order-taker] listening on http://${HOST}:${PORT}`);
});
