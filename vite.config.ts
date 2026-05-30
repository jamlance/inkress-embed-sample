import { defineConfig } from "vite";

// Vite dev/build config for the Inkress embedded-app sample.
//
// `preview` is what Coolify runs in production (after `vite build`).
// The host header allowlist is permissive because Coolify routes
// through nginx with the public hostname; the embedded surface is
// gated by Inkress's session-token handoff regardless.
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  preview: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
