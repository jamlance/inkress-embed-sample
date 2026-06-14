// defineAppKit — wires the config + stores into the singleton an app imports once.
// SERVER ONLY.

import type { OAuthClientConfig } from "./inkress-api";
import type { AppKit, AppKitConfig } from "./types";

/**
 * Build the AppKit singleton (call once in `app/lib/app-kit.server.ts`). Resolves
 * the multi-client credential map and exposes `cfgFor(aud)` so token exchange /
 * refresh present the right client secret for the session JWT's audience.
 */
export function defineAppKit(config: AppKitConfig): AppKit {
  const clientMap =
    config.clients && Object.keys(config.clients).length
      ? { ...config.clients }
      : { [config.clientId]: config.clientSecret };
  const defaultClientId = config.clientId || Object.keys(clientMap)[0]!;

  const cfgFor = (aud?: string | null): OAuthClientConfig => {
    const id = aud && clientMap[aud] ? aud : defaultClientId;
    const secret = clientMap[id];
    if (!secret) {
      throw new Error(`[app-kit] no client secret for client_id "${id}" (aud not in clients map)`);
    }
    return { clientId: id, clientSecret: secret, apiBaseUrl: config.apiBaseUrl };
  };

  return {
    config,
    cfgFor,
    sessionStorage: config.sessionStorage,
    storage: config.storage,
    tokens: config.tokens,
  };
}
