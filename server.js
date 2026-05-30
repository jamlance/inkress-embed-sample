// Tiny static server with the right embedded-apps headers.
//
// Coolify runs this via `npm start`. Vite's `preview` doesn't let us
// set CSP / frame-ancestors, so we layer a 30-line Express server on
// top instead of fighting nginx/Caddy configs.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

// Allow framing by Inkress dashboards. Override via env if you stand
// up a private staging dashboard with a different origin.
const FRAME_ANCESTORS =
  process.env.FRAME_ANCESTORS ??
  "https://merchant.inkress.com https://dev.commerce.webapps.host https://*.commerce.webapps.host";

const app = express();

// Every response gets the CSP frame-ancestors directive so browsers
// allow embedding from the Inkress dashboard. `X-Frame-Options` is
// retained for older clients that don't honour CSP frame-ancestors.
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    `frame-ancestors ${FRAME_ANCESTORS}`,
  );
  // X-Frame-Options can only express ONE allowed origin, so we omit
  // it when we have multiple frame-ancestors. Modern browsers honour
  // CSP frame-ancestors, which supersedes X-Frame-Options anyway.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "clipboard-write=(self)");
  next();
});

app.use(express.static(path.join(__dirname, "dist"), { extensions: ["html"] }));

// SPA fallback so deep links like /a, /b/c work for the embedded
// navigate.embed demo.
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`[embed-sample] listening on http://${HOST}:${PORT}`);
  console.log(`[embed-sample] frame-ancestors: ${FRAME_ANCESTORS}`);
});
