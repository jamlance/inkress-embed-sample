import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import { BvProvider, useReauthHandler } from "@inkress/app-kit/client";
import appKitStyles from "@inkress/app-kit/styles.css?url";
import { getOptionalMerchant } from "~/lib/app-kit.server.mjs";
import { Nav } from "~/components/nav";

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: appKitStyles }];

export async function loader(args: Route.LoaderArgs) {
  const ctx = args.context;
  const m = getOptionalMerchant(args);
  return {
    merchant: m?.merchant ?? null,
    scopes: m?.scopes ?? [],
    mode: ctx.appKit.config.mode,
    // Present only on first-load bootstrap; the client stashes it for the header carrier.
    sessionId: ctx.bootstrap?.sessionId ?? null,
  };
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const connected = Boolean(loaderData.merchant);
  return (
    <BvProvider sessionId={loaderData.sessionId} mode={loaderData.mode}>
      <main className="bv-shell">
        {connected && (
          <>
            <header className="bv-header">
              <img src="/logo.svg" width={30} height={30} alt="" style={{ borderRadius: 8 }} />
              <h1>{loaderData.merchant?.name ?? "Your shop"}</h1>
            </header>
            <Nav />
          </>
        )}
        <Outlet />
      </main>
    </BvProvider>
  );
}

export function ErrorBoundary() {
  // Recover from the kit's reauth signal (401) by re-bootstrapping via app-bridge.
  if (useReauthHandler()) {
    return (
      <main className="bv-shell">
        <div className="bv-empty">
          <span className="bv-spin" />
          <p className="bv-muted">Reconnecting…</p>
        </div>
      </main>
    );
  }
  return (
    <main className="bv-shell">
      <div className="bv-banner">Something went wrong. Try reopening the app from your dashboard.</div>
    </main>
  );
}
