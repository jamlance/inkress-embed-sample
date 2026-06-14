// Standalone (non-embedded) OAuth-redirect callback. Only emitted when the app
// is scaffolded with --standalone. Exchanges the authorization code and sets the
// session cookie. NOTE: the authorize URL / callback flow is opt-in and should
// be verified against your Inkress OAuth client configuration.
import { redirect } from "react-router";
import type { Route } from "./+types/oauth.callback";
import { appKit, exchangeAuthorizationCode } from "~/lib/app-kit.server.mjs";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) throw new Response("missing authorization code", { status: 400 });

  const cfg = appKit.cfgFor(null);
  const redirectUri = `${appKit.config.publicBaseUrl || url.origin}/oauth/callback`;
  const token = await exchangeAuthorizationCode(cfg, code, redirectUri);
  const session = await appKit.sessionStorage.create(token);
  if (appKit.tokens && token.refresh_token) await appKit.tokens.save(session.merchantId, token.refresh_token);
  await appKit.sessionStorage.save(session);

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `bv_app_session=${session.id}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=86400`,
  );
  return redirect("/", { headers });
}
