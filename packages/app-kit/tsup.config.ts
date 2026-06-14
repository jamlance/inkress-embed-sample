import { defineConfig } from "tsup";

// Two builds, two platforms. Everything in node_modules stays external
// (skipNodeModulesBundle) so the kit is a thin layer over our SDKs + deps.
//
//  - server: Node ESM. The secret-touching half (token exchange/refresh,
//    session store, pg, crypto, admin-sdk, services). Imported by the app's
//    server.mjs (raw Node) AND by *.server.* route modules (via Vite).
//  - client: browser ESM. The app-bridge provider/hooks + storefront-sdk.
//
// The isomorphic entry (`index`) is pure types/consts (no node builtins) and
// is built in the server pass but is safe to import from the browser too.
export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "server/index": "src/server/index.ts",
      "server/session": "src/server/session.ts",
      "server/storage": "src/server/storage.ts",
      "server/tokens": "src/server/tokens.ts",
      "server/services": "src/server/services.ts",
    },
    format: ["esm"],
    platform: "node",
    target: "node20",
    dts: true,
    clean: false,
    skipNodeModulesBundle: true,
    sourcemap: true,
  },
  {
    entry: { "client/index": "src/client/index.tsx" },
    format: ["esm"],
    platform: "browser",
    target: "es2022",
    dts: true,
    clean: false,
    skipNodeModulesBundle: true,
    sourcemap: true,
    external: ["react", "react-dom", "react-router"],
  },
]);
