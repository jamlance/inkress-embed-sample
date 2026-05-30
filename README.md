# inkress-embed-sample

Reference implementation of an Inkress embedded app. Exercises every
primitive in [`@inkress/app-bridge`](https://github.com/jamlance/app-bridge)
against the live dashboard surface.

## What this is

A single-page Vite + vanilla TypeScript app that renders inside the
Inkress merchant dashboard via the embedded-apps iframe handoff. Every
button on the page maps to one bridge call so you can:

- Watch the host-side bridge respond to each event in real time.
- Copy-paste working snippets into your own app.
- Smoke-test rate limits, origin checks, and the RFC 8693 token
  exchange end to end.

## Run locally

```bash
npm install
npm run dev          # vite at :3000
```

Direct loads of `http://localhost:3000` will show "Couldn't bootstrap
the bridge — missing_session_token" because the page is designed to
run inside an Inkress iframe. To test the full flow, register an
embedded OAuth app pointing at this URL.

## Build + deploy

```bash
npm run build        # → dist/
npm run preview      # vite preview at :3000, serves dist/
```

For Coolify, set the **build** step to `npm install && npm run build`
and the **start** command to `npm run preview`. The `preview.host`
in `vite.config.ts` binds 0.0.0.0 so Coolify's reverse proxy can route
through.

## Required headers

Your deployed sample **must** allow Inkress as a frame ancestor:

```
Content-Security-Policy: frame-ancestors https://merchant.inkress.com https://*.commerce.webapps.host;
X-Frame-Options: ALLOW-FROM https://merchant.inkress.com
```

(Coolify lets you configure these via its custom-headers config or via
a server upstream like Caddy. The Vite preview server does NOT set
these — you need to layer them at the proxy.)

## The bridge primitives, by section

| Section | Bridge method | What you should see |
|---|---|---|
| Identity | `inkress.config` (auto on ready) | Merchant + user fields populate from the host. |
| Notifications | `inkress.notify` × 4 kinds + spam-15 | Toasts in the dashboard; the spam button burns through the bucket and the last 5 return `rate_limited`. |
| Confirms & modals | `inkress.confirm`, `inkress.modal.open/close` | Host-rendered AlertDialog / Dialog; resolves with the action. |
| Navigation | `inkress.navigate.embed` + `.host` | Embed nav updates the browser URL without an iframe reload; host nav with `/etc/...` is refused client-side. |
| Clipboard / resize | `inkress.clipboard.write`, `inkress.resize` | Host writes to clipboard; resize is clamped to `[200, viewport]`. |
| Session | `session.current/refresh/exchange` | Live token + auto-refresh; exchange returns a real `inka_` token. |

## Source

- Bridge SDK: [github.com/jamlance/app-bridge](https://github.com/jamlance/app-bridge)
- Inkress spec: [`commerce-api/docs/embedded-apps-spec.md`](https://github.com/jamlance/commerce-api/blob/feature/dev-apps/docs/embedded-apps-spec.md)

## License

MIT.
