# @inkress/app-kit

Reusable kit for building **Inkress-embedded apps on React Router v7**. It owns the
parts every app re-implements — the embedded session/OAuth handshake, an authenticated
[`@inkress/admin-sdk`](https://www.npmjs.com/package/@inkress/admin-sdk) client in every
loader/action, persistence, webhook verification, and the client provider/hooks over
[`@inkress/app-bridge`](https://github.com/jamlance/app-bridge) +
[`@inkress/storefront-sdk`](https://www.npmjs.com/package/@inkress/storefront-sdk) — so an
app author writes features, not plumbing.

Scaffold an app with `node scripts/scaffold-app-rr7.mjs <name>` (see repo root).

## Entry points

| Import | Side | Purpose |
|---|---|---|
| `@inkress/app-kit` | iso | Shared types + enums (order-status maps, `Merchant`, `BvTheme`). No secrets. |
| `@inkress/app-kit/server` | **server** | `defineAppKit`, `createInkressServer`, `authenticate.*`, `requireMerchant`, `assertScope`, `loadEnv`, `cspHeaders`, `boundary`, `createWebhookHandler`. |
| `@inkress/app-kit/server/session` | **server** | `SessionStorage` (online tokens): `MemorySessionStorage`, `DrizzleSessionStorage`. |
| `@inkress/app-kit/server/storage` | **server** | `StorageAdapter` (app data) + `createDrizzleStorage`. |
| `@inkress/app-kit/server/tokens` | **server** | `openMerchantTokens` (encrypted offline refresh tokens for webhooks/public). |
| `@inkress/app-kit/server/services` | **server** | `EmailProvider`/`BlobStore`/`NotificationProvider` + AWS defaults. |
| `@inkress/app-kit/client` | client | `BvProvider`, `useBv`, `useToast`, `useConfirm`, `useEmbedNavigate`, `useStorefront`, `bvFetch`. |
| `@inkress/app-kit/styles.css` | client | Design tokens + base styles. |

**Rule:** anything under `/server` is server-only. Importing it from client code leaks the
client secret and admin SDK; the RR7 build will fail (`.server` boundary) and a lint rule
catches it in CI.

## Status

Scaffolding in place (Phase 1). Server core, client kit, and the scaffolder land in the
following phases — see the repo task list / plan.
