// Client session carrier — the X-BV-Session header (+ actor headers) that lets
// RR7's .data/action fetches authenticate WITHOUT cookies (the cross-iframe
// path that survives 3rd-party-cookie blocking). Mirrors Shopify App Bridge's
// fetch interception. CLIENT-SAFE.

const SESSION_KEY = "bv_app_session_id";
let actor: { id?: number | null; name?: string | null } = {};

export function setSessionId(id: string): void {
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* storage blocked */
  }
}
export function getSessionId(): string {
  try {
    return sessionStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}
export function clearSessionId(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}
export function setActor(a: { id?: number | null; name?: string | null }): void {
  actor = a || {};
}

function applyBvHeaders(headers: Headers): void {
  const sid = getSessionId();
  if (sid) headers.set("X-BV-Session", sid);
  if (actor.id != null) headers.set("X-BV-User-Id", String(actor.id));
  if (actor.name) headers.set("X-BV-User-Name", actor.name);
}

function isSameOrigin(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/** Install a same-origin fetch wrapper (call once in entry.client.tsx). RR7's
 *  own data/action requests then carry the session header automatically. */
export function installBvFetch(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __bvFetchInstalled?: boolean };
  if (w.__bvFetchInstalled) return;
  w.__bvFetchInstalled = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (isSameOrigin(url)) {
        if (input instanceof Request && !init) {
          const headers = new Headers(input.headers);
          applyBvHeaders(headers);
          return orig(new Request(input, { headers }));
        }
        const headers = new Headers(init?.headers);
        applyBvHeaders(headers);
        return orig(input, { ...init, headers });
      }
    } catch {
      /* fall through to plain fetch */
    }
    return orig(input, init);
  };
}

/** Explicit fetch with session/actor headers (for the app's own API calls). */
export function bvFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  applyBvHeaders(headers);
  return fetch(input, { ...init, headers });
}
