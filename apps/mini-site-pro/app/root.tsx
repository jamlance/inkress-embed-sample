import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import { useReauthHandler } from "@inkress/app-kit/client";
import appKitStyles from "@inkress/app-kit/styles.css?url";
// Self-hosted fonts (bundled — no runtime CDN dependency, reliable inside the
// embedded iframe, and not render-blocking the way the Google Fonts link was).
import bricolageFont from "@fontsource-variable/bricolage-grotesque/index.css?url";
import hankenFont from "@fontsource-variable/hanken-grotesk/index.css?url";
import styles from "./styles.css?url";

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: bricolageFont },
  { rel: "stylesheet", href: hankenFont },
  { rel: "stylesheet", href: appKitStyles },
  { rel: "stylesheet", href: styles },
];

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

export default function Root() {
  return <Outlet />;
}

export function ErrorBoundary() {
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
