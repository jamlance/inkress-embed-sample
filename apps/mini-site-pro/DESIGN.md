# Mini-site Pro — Design System

Ported from the approved Inkress consumer marketplace / hosted-checkout language ("warm OKLCH + clay"). Scoped: storefront under `.mk-store`, editor inherits app-kit `--bv-*` but uplifted with the same type + warmth.

## Type
- **Display / headings:** 'Bricolage Grotesque', weight 700–800, letter-spacing -0.02 to -0.035em, line-height 1.05–1.1.
- **Body / UI:** 'Hanken Grotesk', 400/500/600, line-height 1.6.
- **Prices & figures:** Bricolage, weight 800, `font-variant-numeric: tabular-nums`.
- Scale uses `clamp()` for fluid display sizes. Contrast ratio between steps ≥1.3. Never flat.
- Body measure capped 60–68ch.

## Color (OKLCH, warm — never #fff/#000)
Foundation tokens (light; dark variants mirror checkout.css):
```
--mk-bg: oklch(0.975 0.013 73)        /* warm paper */
--mk-surface: oklch(0.995 0.006 80)   /* card */
--mk-surface-2: oklch(0.955 0.015 72) /* sunken */
--mk-ink: oklch(0.28 0.021 55)        /* near-black warm */
--mk-muted: oklch(0.52 0.022 60)
--mk-faint: oklch(0.63 0.020 64)
--mk-border: oklch(0.91 0.013 72)
--mk-border-strong: oklch(0.85 0.017 70)
--mk-r-sm 10px / --mk-r 16px / --mk-r-lg 22px
--mk-shadow / -sm / -lg : warm layered (oklch(0.4 0.03 55 / a))
```
**Accent = the merchant's chosen color** (`--accent`), with derived `--accent-ink` (readable text on accent) and `--accent-tint` (washed surface). The chrome (paper/ink/type/spacing) is the premium constant; the accent is theirs.

## Themes (blocks.mjs)
5 presets, each an OKLCH triad, NOT a 135° gradient: `clay` (default, terracotta), `sunset`, `forest`, `mono` (ink), `rose`. Each defines `accent`, `accentInk`, `tint`, and an optional `heroWash` (a soft warm vertical wash for image-less heroes). Hero with an image uses a bottom-anchored warm scrim, not a flat 42% black overlay.

## Layout laws
- **Each block earns a distinct layout.** No eight-identical-cards.
- Hero: editorial. Large Bricolage display, image as a real feature (full-bleed with bottom scrim), logo as a tactile chip, CTA as a solid accent button with a quiet secondary. Left or centered per theme, with real vertical rhythm.
- Products: warm cards with a refined thumb, name in Bricolage, tabular price, an Order button that feels tactile. Generous gap; the grid breathes.
- About/text: single editorial column, ≤65ch, larger leading.
- Gallery: mosaic with varied tile sizing, not a flat uniform grid.
- Testimonials: warm quote cards with an oversized opening quote mark (Bricolage), author in caps-tracked small.
- Hours: ruled two-column list (label / value), tabular values.
- Contact: tactile info rows with small leading icons (unicode), not a plain stack.
- Links: warm pill chips with hover lift.
- Section rhythm varies (alternate surface / paper backgrounds for separation), generous `clamp` padding.

## Motion
Subtle. Hover lifts on cards/buttons (translateY -1 to -2px + shadow), ease-out-quart ~180ms. Never animate layout props. No bounce.

## Bans (enforced)
No system-ui as the primary face. No `#fff`/`#000`. No 135° hero gradients. No identical card grids. No gradient text. No side-stripe accent borders. No em dashes in copy.
