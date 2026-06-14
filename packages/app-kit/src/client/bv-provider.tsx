// BvProvider + hooks — the client identity/host-action layer over @inkress/app-bridge.
// CLIENT-SAFE (no secrets, no server imports). Shopify's AppProvider analogue.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ConfirmArgs,
  InkressApp,
  InkressMerchant,
  InkressUser,
  NotifyArgs,
  Theme,
} from "@inkress/app-bridge";
import type { InkressMode } from "../index";
import { getSessionId, setActor, setSessionId } from "./session";
import { getBridge, reauthenticate as reauthCore } from "./bridge";

export interface BvContextValue {
  /** True once the app-bridge handshake has resolved (or failed). */
  ready: boolean;
  merchant: InkressMerchant | null;
  user: InkressUser | null;
  scopes: string[];
  theme: Theme;
  mode: InkressMode;
  bridge: InkressApp | null;
  notify: (args: NotifyArgs) => void;
  confirm: (args: ConfirmArgs) => Promise<boolean>;
  navigateEmbed: (path: string) => void;
  navigateHost: (path: string) => void;
  /** Re-mint a server session from a fresh JWT (used by the reauth boundary). */
  reauthenticate: () => Promise<boolean>;
}

const Ctx = createContext<BvContextValue | null>(null);

export interface BvProviderProps {
  children: ReactNode;
  /** From the root loader on first-load bootstrap; stashed for the header carrier. */
  sessionId?: string | null;
  /** storefront-sdk / SDK mode. Default 'live'. */
  mode?: InkressMode;
  /** Resource route the client re-bootstrap posts the JWT to. Default "/bv/bootstrap". */
  bootstrapPath?: string;
}

export function BvProvider({ children, sessionId, mode = "live", bootstrapPath = "/bv/bootstrap" }: BvProviderProps) {
  const [ready, setReady] = useState(false);
  const [merchant, setMerchant] = useState<InkressMerchant | null>(null);
  const [user, setUser] = useState<InkressUser | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>("light");
  const bridgeRef = useRef<InkressApp | null>(null);

  const reauthenticate = (): Promise<boolean> => reauthCore(bootstrapPath);

  useEffect(() => {
    let cancelled = false;
    // Stash the bootstrap session id before any client fetch can fire.
    if (sessionId) setSessionId(sessionId);
    // Only attempt the app-bridge handshake when actually inside an iframe.
    // On a top-level page (local dev, or standalone OAuth mode) there is no
    // parent dashboard to answer, so awaiting the handshake would hang the app
    // (and never let the page settle). Skip straight to ready.
    const embedded = typeof window !== "undefined" && window.top !== window.self;
    if (!embedded) {
      setReady(true);
      return;
    }
    (async () => {
      try {
        const app = await getBridge();
        if (cancelled) return;
        bridgeRef.current = app;
        setMerchant(app.merchant);
        setUser(app.user);
        setScopes(app.scopes);
        setTheme(app.theme);
        setActor({ id: app.user?.id ?? null, name: null });
        document.documentElement.setAttribute("data-theme", app.theme);
        app.events.on("theme.changed", (p) => {
          setTheme(p.theme);
          document.documentElement.setAttribute("data-theme", p.theme);
        });
        // No carrier yet (reload with cookies blocked / cleared storage) → bootstrap.
        if (!getSessionId()) await reauthenticate();
      } catch {
        /* render anyway; loaders will trigger the reauth boundary */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      // The bridge is a shared singleton (getBridge) — don't destroy it here,
      // just drop our ref. It lives for the page's lifetime.
      cancelled = true;
      bridgeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<BvContextValue>(
    () => ({
      ready,
      merchant,
      user,
      scopes,
      theme,
      mode,
      bridge: bridgeRef.current,
      notify: (a) => bridgeRef.current?.notify(a),
      confirm: (a) => bridgeRef.current?.confirm(a) ?? Promise.resolve(false),
      navigateEmbed: (p) => bridgeRef.current?.navigate.embed(p),
      navigateHost: (p) => bridgeRef.current?.navigate.host(p),
      reauthenticate,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, merchant, user, scopes, theme, mode],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBv(): BvContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBv must be used within <BvProvider>");
  return v;
}
export const useToast = () => useBv().notify;
export const useConfirm = () => useBv().confirm;
export const useEmbedNavigate = () => useBv().navigateEmbed;
export const useTheme = () => useBv().theme;
