# Bookerva-apps UI/UX guide

A short, opinionated guide so 28 apps look like siblings but not
clones. Read this before writing any app's `main.ts`.

## The 3-line rule

Every app's first screen answers, in this order:

1. **Who am I looking at?** (the merchant — auto-rendered in `.bv-header`)
2. **What's happening?** (the headline data — counts, totals, status)
3. **What can I do?** (the primary action, usually one button)

If you can't fit all three above the fold, the screen is doing too
much. Split into tabs or a second view.

## Voice & tone

- **Direct over clever.** "Send 5 reminders" beats "Spark some
  customer love ✨".
- **Use the merchant's units.** Currencies → `Intl.NumberFormat`
  with the merchant's `currency_code`. Dates → relative for the last
  7 days, absolute beyond ("3 days ago" vs "May 28").
- **No exclamation marks** in copy unless something genuinely
  good/bad happened. Empty states, loading states, headings: all
  declarative.
- **No "we" or "our".** It's the merchant's data. "Your orders",
  "Your customers". Never "our customers".
- **Identify the partner once, not everywhere.** The `<span class="bv-pill">by Bookerva</span>`
  in the header is enough. Don't sprinkle it into copy.

## Layout

Use the shared primitives. Don't reinvent:

| Need | Use |
|---|---|
| Outer container | `<div class="bv-shell">` (max-width 1100, padded) |
| Section title | `<h2 class="bv-section-title">` (uppercase, muted) |
| Grouped block | `<div class="bv-card">` (one border, one radius) |
| Multiple stat tiles | `<div class="bv-grid bv-grid-3">` + bv-card per tile |
| Tabular data | `<table class="bv-table">` |
| Status badge | `<span class="bv-pill" data-tone="success">` |
| Code-like ids | `<span class="bv-mono">` |

**Spacing rules.** Between cards: 12px (handled by `.bv-card +
.bv-card`). Inside a card: 18px padding (default). Between sections:
18px (handled by `.bv-section-title` top margin). Don't add custom
spacing — adjust the section.

**Card density.** A card holds *one idea*. If a card has 4+ sub-headings,
split it.

## States — all four are mandatory

Every screen that loads data renders all four states. Don't skip the
boring ones.

1. **Loading.** `.bv-skeleton` shimmer bars (3 of them, varying
   widths) shaped like the eventual content. Never a centered
   spinner — those communicate nothing.
2. **Empty.** `.bv-empty` (centered, muted) with one sentence
   describing why it's empty and one clickable next step if there is
   one. E.g. "No promo codes yet. **Create your first code →**".
3. **Error.** A bv-card with the lucide-style alert icon, one
   sentence in plain English explaining what failed, and a retry
   button if the action can be retried. Never show stack traces.
4. **Populated.** The actual data.

## Forms

- One column. Labels above inputs, not beside.
- Use `<label class="bv-label">` (uppercase, muted, tight).
- Submit button is **primary**; cancel/secondary is `.ghost`.
- Validate inline on blur, not on every keystroke.
- A failed submit shows the field-level error AND surfaces a toast
  via `inkress.notify({ kind: 'error', message })` so the user
  doesn't have to scroll to find what's wrong.

## Notifications

- Use `inkress.notify` (host-rendered toast) for any non-destructive
  action confirmation: created/updated/deleted/sent.
- Use `inkress.confirm` (host-rendered alert dialog) for destructive
  actions: revoke, delete, refund, kick customer.
- Use a `bv-card` with the alert icon for **inline** errors that
  block proceeding (auth issues, scope missing).
- Never `alert()`, `confirm()`, or `prompt()` — sandboxed iframes
  block them and they're terrible UX anyway.

## Color usage

- **Primary** (blue / terracotta) — *one* per screen. The single
  most-important action. Never two primary buttons in one card.
- **Destructive** — strictly for destroy/revoke/refund actions.
  Never for "Cancel".
- **Muted** — secondary text, captions, "or" separators, breadcrumbs.
  90% of supporting text should be muted, not full foreground.
- **Pills with tones** (`data-tone`) — match the message:
  - `success` = paid, delivered, active, healthy
  - `warning` = pending, draft, needs review
  - `destructive` = failed, refunded, revoked
  - `primary` = informational tag (currency code, app version)
  - (no tone) = neutral metadata

## Brand differentiation

Apps are siblings, not clones. Each app expresses personality through:

- **The headline copy of the first card** — what makes THIS app
  unique. *Expense Logger* shows "This month so far: $X profit". *Gift
  Registry* shows "3 active registries · 12 items claimed".
- **Icon choice in the breadcrumb pill** — pick a lucide icon that
  captures the app's purpose.
- **Which Inkress data it foregrounds** — Currency Dashboard leads
  with wallet balances; Promo Code Manager leads with redemption
  count.

Apps do **not** differ via custom colors, custom fonts, custom radii,
or per-app brand chrome. The design system is the design system.

## File structure per app

Use what `scaffold-app.mjs` creates. The pattern is fixed:

```
apps/<name>/
├── index.html          – data-brand attribute, app title, loads main.ts
├── package.json        – workspace dep on @bookerva-apps/core
├── tsconfig.json
├── vite.config.ts
├── Dockerfile          – multi-stage, builder + slim runtime
├── server.js           – mounts mountAppCore, app-specific /api/* routes
└── src/
    ├── index.css       – `@import "@bookerva-apps/core/styles.css";`
    ├── bv-init.ts      – shared bootstrap (DON'T edit)
    └── main.ts         – app UI lives here
```

Keep `main.ts` flat. If it grows past ~400 lines, split into
`src/<feature>.ts` modules and import.

## The reference app

`apps/currency-dashboard` is the canonical reference. When in doubt:

```
$ open apps/currency-dashboard/src/main.ts
```

Match that structure. Match its function names. Match its
escape-html and formatters. Don't reinvent them per app — copy them.

## What this guide deliberately does NOT cover

- Per-vertical icon choices (use lucide; pick what fits)
- Microcopy for specific apps (write it in the app's main.ts)
- Component-library-style abstractions (we don't have a component
  library; primitives + plain HTML are enough for 28 apps)
- Animation (use the existing bv-shimmer / bv-toast-in; don't add new)

If you find yourself wanting something the guide doesn't permit,
that's the signal to *not add it*. The whole point is 28 apps that
feel native, not 28 design experiments.
