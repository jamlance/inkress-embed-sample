# DESIGN.md — Bookerva / Marketplace embedded apps

Light theme, OKLCH, two brands. The scene: a Caribbean shop or salon
owner glancing at their phone behind the counter in daylight, or at a
laptop in-store. Bright, glanceable, calm. Never dark-mode-developer.

## Color (OKLCH)

Neutrals are tinted toward the brand hue (chroma ~0.006). No `#000`/`#fff`.

### Marketplace (cool blue) — `:root`, `[data-brand="marketplace"]`

| Token | OKLCH | Use |
|---|---|---|
| `--bg` | `0.985 0.004 250` | app background |
| `--surface` | `1 0 0` tinted → `0.995 0.003 250` | cards, content |
| `--panel` | `0.965 0.006 250` | nav bars, toolbars, second layer |
| `--ink` | `0.22 0.02 255` | primary text |
| `--ink-soft` | `0.46 0.02 255` | secondary text |
| `--ink-faint` | `0.62 0.015 255` | captions, placeholders |
| `--line` | `0.90 0.008 255` | hairline borders |
| `--line-strong` | `0.84 0.01 255` | input borders |
| `--accent` | `0.55 0.17 255` | primary actions, selection |
| `--accent-press` | `0.48 0.17 255` | active accent |
| `--accent-wash` | `0.95 0.04 255` | tinted accent surfaces |
| `--accent-ink` | `0.99 0.01 255` | text on accent |

### Bookerva (terracotta) — `[data-brand="bookerva"]`

Same token names, warmer:

| Token | OKLCH |
|---|---|
| `--bg` | `0.985 0.006 55` |
| `--surface` | `0.997 0.004 55` |
| `--panel` | `0.965 0.01 55` |
| `--ink` | `0.24 0.02 50` |
| `--ink-soft` | `0.46 0.025 50` |
| `--line` | `0.90 0.012 55` |
| `--accent` | `0.62 0.15 45` |
| `--accent-press` | `0.55 0.15 45` |
| `--accent-wash` | `0.955 0.035 55` |

### Semantic (shared)

| Token | OKLCH | Meaning |
|---|---|---|
| `--ok` | `0.62 0.15 155` | paid, active, success |
| `--ok-wash` | `0.95 0.04 155` | |
| `--warn` | `0.74 0.15 75` | pending, draft |
| `--warn-wash` | `0.96 0.05 80` | |
| `--bad` | `0.58 0.20 25` | failed, refunded, destructive |
| `--bad-wash` | `0.95 0.05 25` | |

## Elevation

Depth is real here, not flat borders. Layered, low-spread shadows tinted
with the brand hue.

- `--e1`: `0 1px 2px oklch(0.5 0.03 255 / 0.06), 0 1px 1px oklch(0.5 0.03 255 / 0.04)` — resting cards
- `--e2`: `0 2px 8px oklch(0.5 0.03 255 / 0.08), 0 1px 2px oklch(0.5 0.03 255 / 0.06)` — raised / hover
- `--e3`: `0 8px 28px oklch(0.4 0.03 255 / 0.14), 0 2px 6px oklch(0.4 0.03 255 / 0.08)` — popovers, sheets

Cards rest on `--e1` and lift to `--e2` on hover when interactive. Hairline
border `--line` on top of the shadow for crisp edges on light bg.

## Typography

Inter (with system fallback). Fixed rem scale, ratio ~1.2. Weights
400/500/600/700. Tabular numerals for data.

| Step | Size / line | Weight | Use |
|---|---|---|---|
| display | 1.75rem / 1.15 | 700 | public page hero |
| h1 | 1.375rem / 1.2 | 650 | app title |
| h2 | 1.0625rem / 1.3 | 600 | section / card title |
| body | 0.875rem / 1.5 | 400 | default |
| label | 0.6875rem / 1.3 | 600, +0.04em, uppercase | field labels, kickers |
| data | 0.9375rem / 1.3 | 600, tabular-nums | numbers, money |
| mono | 0.8125rem | 500 | codes, ids |

## Spacing & radius

4px base. Rhythm varies: 4 / 8 / 12 / 16 / 24 / 32 / 48. Radius: `--r-sm`
6px (inputs, pills), `--r` 10px (cards), `--r-lg` 16px (sheets, public
cards). Generous internal padding on cards (18–22px); tighter on dense
tables.

## Components (every interactive one ships all states)

default · hover · focus-visible · active · disabled · loading · error

- **App shell**: sticky top bar (`--panel`, `--e1`) with brand mark + app
  name + tab nav; content max-width 1120, 24px gutters. Tabs underline the
  active one with `--accent`, animate the underline 180ms ease-out.
- **Buttons**: `primary` (filled `--accent`, white ink, `--e1`, lifts on
  hover), `secondary` (`--accent-wash` fill, accent ink), `ghost`
  (transparent, hover `--panel`), `danger` (filled `--bad`). 36px height,
  `--r-sm`, 600 weight. Focus ring `0 0 0 3px accent/22%`.
- **Stat tiles**: NOT the hero-metric cliché. A label, a number, and a
  contextual delta or sparkline. Vary sizes; never an identical 3-up grid
  of icon+number.
- **Cards**: `--surface`, `--e1`, `--line`, `--r`, 20px padding. Section
  cards get a header row (title + action) separated by a hairline.
- **Tables**: sticky header on `--panel`, row hover `--panel`, no zebra,
  hairline row dividers, right-aligned numerics with tabular-nums, a
  trailing actions column. Row click opens detail.
- **Forms**: label above (`label` step), input 38px, `--line-strong`
  border, focus → `--accent` border + ring. Inline error text in `--bad`
  under the field + a shake-free red ring.
- **Pills/badges**: `--r-sm`, semantic wash bg + ink, 600, 0.6875rem.
- **Empty states**: a line-icon, one sentence of what goes here, one
  primary action. Teaches, doesn't apologize.
- **Skeletons**: shimmer sweep 1.4s, shaped like the content.
- **Toasts**: bottom-right, `--e3`, slide+fade in 180ms ease-out, semantic.

## Iconography

Inline SVG, lucide-style: 1.5px stroke, round caps/joins, 20px default,
`currentColor`. One curated set in `core/src/icons.ts`. No emoji as UI
icons, no icon fonts.

## Public pages (customer-facing, no auth)

Different register: the MERCHANT'S brand leads, Committed color allowed.

- A **drenched brand header**: a band in the merchant's theme colour (or
  the app accent), merchant logo + name, generous padding.
- One focused **action card** on `--surface`, `--r-lg`, `--e2`, centered,
  max-width 460, big touch targets (44px+).
- Mobile-first; everything works thumb-first at 390px.
- Quiet footer: "powered by Bookerva" / "secured by Inkress".
- QR codes rendered crisp (SVG or high-res), with the link shown as
  `--mono` for manual entry.

## Motion

150–220ms, ease-out (`cubic-bezier(0.22, 1, 0.36, 1)`). Hover lifts,
focus rings, tab underline slides, toasts/sheets reveal. Never animate
layout; never bounce; no page-load choreography on the merchant side.
