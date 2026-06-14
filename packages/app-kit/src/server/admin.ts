// admin-sdk client construction — SERVER ONLY.

import { InkressSDK } from "@inkress/admin-sdk";
import type { InkressMode } from "../index";
import type { Session } from "./session";

/** Build an authenticated admin SDK client from a resolved session. The access
 *  token never leaves the server (this instance is non-serializable, so RR7
 *  errors if a loader tries to return it). */
export function buildAdmin(session: Session, mode: InkressMode, username?: string | null): InkressSDK {
  return new InkressSDK({
    accessToken: session.accessToken,
    mode,
    ...(username ? { username } : {}),
  });
}
