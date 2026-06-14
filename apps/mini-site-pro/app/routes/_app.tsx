import { Outlet } from "react-router";
import type { Route } from "./+types/_app";
import { BvProvider } from "@inkress/app-kit/client";
import { getOptionalMerchant } from "~/lib/app-kit.server.mjs";

export async function loader(args: Route.LoaderArgs) {
  const ctx = args.context;
  const m = getOptionalMerchant(args);
  return {
    connected: Boolean(m),
    mode: ctx.appKit.config.mode,
    sessionId: ctx.bootstrap?.sessionId ?? null,
  };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return (
    <BvProvider sessionId={loaderData.sessionId} mode={loaderData.mode}>
      {loaderData.connected ? (
        <Outlet />
      ) : (
        <main className="bv-shell">
          <div className="bv-empty">
            <h1>Mini-site</h1>
            <p className="bv-muted">Open this app from your Inkress dashboard to build your storefront.</p>
          </div>
        </main>
      )}
    </BvProvider>
  );
}
