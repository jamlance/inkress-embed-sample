# Spec — remaining standalone marketplace apps

Each follows the rules in the README: lead with real data, public page
where a customer is involved, multi-view, real effects, attribution.

## Currency Dashboard
**Value:** for JMD+USD merchants, one view of money across currencies.
**Real version:** live wallet balances per currency (Inkress
`account/balances`), sales rollups per currency over a selectable window,
FX-equivalent total at the day's rate, pending payouts per currency.
Views: Overview, By currency (drill into orders), Settings (display
currency). No customer side. **Reads only**, but real and useful.

## Expense Logger
**Value:** know if the month is actually profitable.
**Real version:** log expenses by category; P&L = live Inkress revenue
(paid orders) − expenses, this month + trend; category breakdown;
export CSV for the accountant. Views: Overview (P&L), Expenses (list +
add + receipt photo to S3), Reports (monthly, export). Attribution on
entries.

## Gift Registry
**Value:** weddings/showers; let customers build a registry and guests
buy items that pay the merchant.
**Real version:** merchant creates registries OR a customer creates their
own from a public page; items are real merchant products; a guest
"claims + buys" an item via an Inkress **checkout session** (real
payment to the merchant); claimed items update live. Public registry page
(`/r/{slug}`, no auth) with merchant branding. Views: Registries (list +
items + claimed/paid), Settings. Customer side is the registry + buy
flow.

## Event Tickets
**Value:** sell tickets, scan at the door.
**Real version:** create event (price, capacity); **public ticket page**
(`/event/{id}`, no auth) where a customer buys via Inkress checkout
session; on payment a ticket with a **QR** is issued + emailed (SES);
merchant **scanner** view validates QR at the door (single-use,
checked-in state). Views: Events, Tickets (issued/checked-in), Scanner,
Settings. Two-sided.

## Subscription Boxes
**Value:** recurring revenue.
**Real version:** plans (cadence, price); customers subscribe from a
**public page** paying via Inkress (recurring through Inkress billing
where available, else scheduled checkout links); roster + next-renewal +
churn; dunning email on failed renewal (SES). Views: Plans, Subscribers
(detail + history), Settings. Customer subscribe page.

## Restaurant Menu + QR
**Value:** at-table ordering.
**Real version:** menu items by category with photos (S3) + availability;
**public menu page** (`/m/{merchant}`, no auth) the diner reaches by QR,
browses, and **orders** (cart → Inkress checkout session → kitchen sees
the paid order). Modifiers/options. Views: Menu builder, Orders
(incoming, from the public menu), QR/share, Settings. Two-sided.

## Document Vault
**Value:** store contracts/receipts/IDs against customers and orders.
**Real version:** upload files to **Bookerva S3** (not local disk),
attach to an Inkress customer or order (real ids), tag, expiry, audit log
of views/downloads with attribution; signed-URL downloads. Views: All
docs (filter by attached entity), Upload, per-customer/order view.
No customer side (internal), but real storage + linkage + audit.

## Invoices / Receipts (render suite)
**Value:** branded documents from real orders.
**Real version:** list real Inkress orders; generate a branded invoice/
receipt (merchant logo/colour from S3) as a proper PDF (server-side
render) — emailable to the customer (SES) and downloadable; receipt
format for thermal. Views: Orders → document, Branding (logo/colour),
Sent log. Customer receives the emailed PDF.

## Donation Receipts
**Value:** churches/NGOs issue tax-style receipts.
**Real version:** record donations OR take them via a **public donate
page** (`/give/{merchant}`, no auth) through Inkress checkout; issue a
branded PDF receipt (SES + download); annual summary per donor. Views:
Donations, Donors (yearly totals), Donate page, Settings. Two-sided.

## Promo Codes
**Value:** discount codes that actually work at checkout.
**Real version:** create codes (percent/fixed, limits, expiry);
**validation endpoint** the merchant's Inkress checkout calls to apply a
code; redemption tracking (which order, when); per-code performance
(revenue influenced). Views: Codes (list + performance), Create,
Redemptions. Attribution. The "real" gap to close: confirm how Inkress
checkout consumes an external discount, and wire to that (or apply via
order metadata + a documented checkout hook).

## Cross-cutting build notes

- **S3**: reuse Bookerva's storage adapter (it's ours) for all uploads
  (logos, covers, receipts, menu photos, galleries) rather than local
  disk, so files survive redeploys and get signed delivery.
- **Public pages**: served by the same deploy at no-auth routes,
  resolving the merchant by id/slug, rendering the merchant's brand.
- **Payments**: always Inkress checkout sessions for customer payments;
  direct orders only for in-person/cash.
- **Email**: SES for all customer/merchant email.
- **Persistence**: needs a Coolify volume at `/data` (or move app state
  to a shared Postgres) so SQLite survives redeploys. Tracked.
