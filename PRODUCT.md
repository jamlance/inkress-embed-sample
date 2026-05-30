# PRODUCT.md — Bookerva / Marketplace embedded apps

## Register

product

(These are merchant-facing tools and customer-facing transactional pages.
Design serves the task; it is not the product itself.)

## Product purpose

A suite of embedded apps that live inside the Inkress merchant dashboard
(in an iframe) and extend what a merchant can do without leaving their
admin. Two families:

- **Marketplace apps** — cross-vertical merchant tools: promo codes,
  expense tracking, gift cards, invoices/receipts, event tickets,
  subscriptions, restaurant menu + QR, pre-orders, document vault,
  phone-order taking, automation (digests, birthday emails, order
  tagging, stock alerts, order-update messaging).
- **Bookerva apps** — appointment-booking verticals (tradesman, salon,
  auto service, tuition, gym, photography, cleaning, catering, generic).
  Bookerva is a real booking SaaS; these are its branded surfaces inside
  Inkress.

Each app has TWO sides:

1. **Merchant side** (inside the dashboard iframe, authenticated) — where
   the owner/staff configure and operate.
2. **Public side** (a shareable link / QR, NO auth) — where the merchant's
   *customers* act: book an appointment, buy a ticket, claim a registry
   gift, redeem a gift card, view a menu, pre-order. These pages must
   work with zero session.

## Users

- **Merchant owner-operators** in Jamaica and the wider Caribbean. Small
  to mid businesses: salons, mechanics, restaurants, event promoters,
  tutoring centres, churches, retail shops, tradesmen. Phone-first,
  WhatsApp-native, time-poor, not technical. They judge an app in 10
  seconds: does it show me something useful and let me do the one thing
  I came to do?
- **Merchant staff** — cashiers, stylists, front-desk. Need fast,
  unambiguous actions; limited patience for chrome.
- **End customers** — the merchant's customers, on their own phones,
  hitting public links. They have never heard of Inkress or Bookerva.
  The page must feel like it belongs to the merchant (their logo, their
  name) and be dead-simple on a phone.

## Brand

Two visual identities, switched by a `data-brand` attribute:

- **Marketplace** — cool, capable, trustworthy. Confident blue. Reads as
  "the smart tools that came with my Inkress account." Slightly techy but
  warm. Not a generic SaaS dashboard.
- **Bookerva** — warm, human, hospitable. Terracotta / clay. Reads as
  "an appointment book a real person keeps." Editorial, calm, tactile.

Both must feel native to the Inkress dashboard (which is a warm-neutral
shadcn palette) without looking like Inkress built them — they are
partner apps. Customers on public pages should feel the *merchant's*
brand foremost, with a quiet "powered by" footer.

## Tone

Direct, plain, confident. Caribbean-businesslike: friendly but not
cutesy, never corporate-bland. "Send 5 reminders," not "Spark customer
delight." Use the merchant's own units (their currency, their customer
names). One exclamation mark per app, maximum, and only when something
genuinely good happened.

## Anti-references (do NOT look like these)

- Flat shadcn-neutral admin dashboards with identical card grids. This is
  exactly what the first version failed as: gray boxes, one weight, no
  depth, no color, no hierarchy. Burn it down.
- Generic SaaS hero-metric templates (big number, tiny label, repeat).
- Stripe-clone monochrome minimalism (this is for small Caribbean
  merchants, not Silicon Valley devs).
- Linear/Vercel dark-mode-developer aesthetic. Wrong audience.
- Toy single-screen forms with one button. Every app must have real
  surface area: views, navigation, lists, detail, state.

## Strategic principles

1. **Two-sided or it's not real.** If an app has a customer action, it
   ships a public no-auth page for it, plus a shareable link + QR. A
   booking app with no booking page is not a booking app.
2. **Show data before asking for input.** Open on the merchant's real
   numbers and records (seeded/live), not an empty form.
3. **Multi-view by default.** A real app has at least: an overview, a
   working list, a detail/create flow, and settings. One screen = a toy.
4. **Attribution everywhere.** Every action records WHO did it (the
   dashboard user from the session) and WHEN. Staff accountability is a
   real merchant need.
5. **Things actually happen.** Emails actually send (SES). Orders the app
   claims to tag/update actually change. Gift cards have real codes + QR.
   No fake buttons.
6. **The merchant's brand on customer pages.** Public pages carry the
   merchant's logo, name, colours, and a small "powered by Bookerva /
   Marketplace" footer. Never our chrome over their customers.
7. **Phone-first.** Both sides must be excellent on a 390px screen.
