// @inkress/app-kit/client — CLIENT-SAFE React surface (no secrets, no server imports).

export {
  BvProvider,
  useBv,
  useToast,
  useConfirm,
  useEmbedNavigate,
  useTheme,
} from "./bv-provider";
export type { BvContextValue, BvProviderProps } from "./bv-provider";

export { useStorefront } from "./use-storefront";
export type { StorefrontClient, PaymentUrlOptions } from "./use-storefront";
export { useReauthHandler } from "./boundary";
export { getBridge, reauthenticate } from "./bridge";
export {
  installBvFetch,
  bvFetch,
  getSessionId,
  setSessionId,
  clearSessionId,
  setActor,
} from "./session";
