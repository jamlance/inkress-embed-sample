# App specs — architecture & the rules every app follows

This folder has one spec per app. Each answers: what value does a real
merchant get, what's the actual workflow (merchant side AND customer
side), what does the **platform** (Bookerva + Inkress) provide vs. what
we build, what are the data-integrity rules, and what are the views.

Read this README first. It encodes the decisions that the first build
got wrong.

## The platform we build ON (stop reinventing it)

### Bookerva — our own booking SaaS. Live at `bookerva.tserve.webapps.host`.

We own it. We can call its API and edit its code. It already provides:

- **Public booking page**: `/book/{slug}` — service picker → availability
  → client details → Inkress payment → confirmation. Embeddable
  (`?embed=true`). This is the customer self-booking surface. We do NOT
  rebuild it; we provision the tenant, configure it, and link/embed it.
- **Public REST API** (`/api/v1/book/{slug}/...`): `GET services`,
  `GET providers`, `GET availability`, `POST book`, cancel/reschedule
  (short-lived JWT).
- **Dashboard tRPC** (appointments, services, team, clients,
  intake-forms, calendar, notifications, payments, billing, ai).
- **Availability engine**, **calendar** (day/week/month + Google Meet /
  Zoom), **team/providers** (staff, working hours, time-off),
  **notifications** (email/SMS/WhatsApp with templates + quiet hours),
  **S3 storage** (galleries, file delivery), **intake forms**
  (per-vertical custom fields), **service options** (variants/add-ons),
  **bundles**.
- **Existing Inkress link**: `merchantPaymentAccount` ties a Bookerva
  tenant to an Inkress merchant; bookings become Inkress orders. Inkress
  **merchant 183 (Jack Jack)** already maps to **Bookerva tenant 10**
  (`merchants.data.bookerva_id = "10"`).

**Therefore every Bookerva-vertical app is a vertical-tailored Inkress
dashboard INTO that merchant's Bookerva tenant.** It surfaces real
appointments, real staff, real calendar, real notifications, and links
the real public booking page. Where a vertical needs something Bookerva
doesn't expose yet (e.g. photo-gallery delivery, recurring cleaning
plans), we add it to Bookerva (it's ours) rather than building a parallel
silo.

**Integration path (server-to-server):** the embedded app's backend
resolves the merchant's `bookerva_id` from the Inkress merchant record,
then calls Bookerva. Bookerva needs a partner/service auth for
machine-to-machine calls from our backend; we add a scoped service-token
endpoint to Bookerva (mirrors its existing public-token pattern). Auto-
provision a Bookerva tenant on first open if the merchant has none.

### Inkress — the commerce/payments platform.

- **Checkout sessions** (`POST /api/v1/checkout/sessions`) are the right
  primitive for order-creating apps. You send `{total | products[],
  currency_code, customer{}, title}` and get back `payment_url` +
  `frame_url`. **No live order is created until the customer pays** — the
  payment webhook auto-creates it. This avoids data drift and respects
  Inkress integrity (order lines + total are immutable once an order
  exists).
- **Direct orders** (`POST /api/v1/orders`): creates a *live* order
  immediately (status 1 pending), `reference_id` unique, total + lines
  immutable after create. Use only for "record an in-person/cash sale
  now" flows.
- **Payment link for an existing order**: `POST /orders/:id/lynkify`.
- **Inkress does NOT send** SMS/email/WhatsApp. The app delivers the
  `payment_url` itself (we have AWS SES verified on `bookerva.com`; SMS/
  WhatsApp via the merchant's own channel or a future adapter).
- **Customers** are auto-created from the `customer{}` object on
  order/session create. No separate create call needed.
- **Order status**: 1 pending · 3 paid · 4 confirmed · 6 prepared ·
  7 shipped · 8 delivered · 9 completed · 5 cancelled · 11 refunded.
  Only 1/4/6 are cancellable; paid orders can't have lines/total changed.

## Rules every app follows

1. **Lead with the merchant's real data.** Open on live numbers/records
   from Bookerva/Inkress, not an empty form.
2. **Two-sided when customers are involved.** Ship the public, no-auth
   surface (booking page = Bookerva's; gift-card view, registry, ticket,
   pre-order, menu = our public pages). A customer link that demands a
   merchant session is broken.
3. **Multi-view.** Real apps have an overview, a working list, a
   detail/create flow, and settings. One screen is a toy.
4. **Things actually happen.** Orders are real Inkress checkout sessions.
   Payment links are real and delivered. Emails actually send via SES.
   Order tags/status actually write back to Inkress. Galleries actually
   store + deliver files.
5. **Attribution + integrity.** Every write records who did it. Never
   mutate immutable Inkress fields; never let app state silently diverge
   from Inkress (prefer sessions/webhooks over speculative writes).
6. **Vertical identity.** The 9 Bookerva verticals are NOT one UI in
   different colors. Each has features its trade actually needs (below)
   and its own accent + tailored sections, within one cohesive system.

## Design direction (correcting the last pass)

The last pass improved craft but: every vertical looked identical, the
background tint + brand divergence were too loud. Correction:

- **Near-white surfaces.** Background is barely tinted (oklch L ~0.99,
  chroma ~0.003). Color lives in accents, status, and small moments, not
  the whole canvas. Restrained is the floor.
- **One cohesive system, not two vastly different brands.** Marketplace
  and Bookerva share the same neutrals, type, spacing, components. They
  differ only in the accent hue and the wordmark. "Unique, not trying too
  hard."
- **Per-vertical accent + sections.** Each booking vertical gets its own
  accent (salon plum, auto steel, photography indigo, cleaning teal,
  tradesman amber, tuition green, gym violet, catering rust) and
  vertical-specific panels — so they read as siblings, not clones.
- **Quieter public pages.** A clean branded header (merchant logo + name
  on a calm band, not a drenched gradient), then the focused action.

## Index

| App | Spec | Platform leverage |
|---|---|---|
| Bookerva verticals (9) | [bookerva-verticals.md](bookerva-verticals.md) | Bookerva tenant + booking page + calendar + staff + storage |
| Phone Order Taker | [phone-order-taker.md](phone-order-taker.md) | Inkress checkout sessions + products |
| Pre-orders | [pre-orders.md](pre-orders.md) | Inkress checkout sessions |
| Gift Cards | [gift-cards.md](gift-cards.md) | Inkress checkout sessions (sell) + own ledger (redeem) |
| Order Tagger | [order-tagger.md](order-tagger.md) | Inkress orders read + status/metadata write |
| Sales Digest + automation | [automation.md](automation.md) | Inkress orders/customers + SES |
| Other standalone | [standalone.md](standalone.md) | per-app |

Each spec is reviewed against the rule set above before its app is built.

