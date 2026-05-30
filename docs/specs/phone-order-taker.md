# Spec — Phone Order Taker

## The questions you asked, answered

- **Does it create a real Inkress order?** Not speculatively. It creates
  an Inkress **checkout session** (`POST /api/v1/checkout/sessions`). The
  live order is auto-created by Inkress's payment webhook only when the
  customer pays. This is deliberate: it avoids app↔Inkress drift and
  respects Inkress integrity (order lines + total are immutable once an
  order exists).
- **Does it generate a payment link and send it?** Yes. The session
  returns `payment_url` (+ `frame_url`). The app sends it to the customer
  by **SES email** and/or copy-to-WhatsApp (Inkress itself sends nothing).
- **Is sending optional?** Yes. Three close-out modes per order:
  1. **Send link** — email/WhatsApp the `payment_url`, customer pays
     later. (default for phone orders)
  2. **Take payment now** — open `frame_url` on the counter device for
     card entry while the customer's on the line.
  3. **Mark as cash / in person** — create a *direct* Inkress order
     (`POST /orders`, status pending→paid) for cash sales, no link.
- **Can the user view + edit the order to match what the customer wants,
  while keeping Inkress integrity?** Yes, *before payment*. The order
  lives as an app-side **draft** until a session is issued. The operator
  freely edits lines/customer/notes on the draft. Issuing the link
  freezes the cart into a session (Inkress derives totals). If the
  customer changes their mind before paying, the operator **voids the
  session and issues a new one** (cheap; no live order touched). Once
  paid, the order is a finalized Inkress order; line/total edits are
  forbidden by Inkress, so the app only allows status/fulfillment +
  metadata changes after that, matching Inkress's own rules.
- **Sync only on fulfillment, or just updated?** Neither "speculative
  create" nor "sync on fulfillment." The correct model is **sync on
  payment** via the session→webhook. The draft is app-only until the
  customer commits money; then Inkress owns it. Fulfillment status after
  that is written back to Inkress (`PATCH /orders/:id` status), so Inkress
  stays the source of truth.

## Why a merchant uses it

"A customer calls. I need to take their order fast while they're on the
line: search my real products, build the cart, capture their details,
then either send them a pay link or charge a card right now, and have it
land in my Inkress orders like any other sale, not in some separate
spreadsheet I have to reconcile."

## Workflow

1. **New order** (keyboard-fast): search live Inkress products
   (`GET /products`), add lines with qty, live subtotal. Pick/enter
   customer (name, phone, email). Add a note.
2. **Review**: the draft shows lines, customer, computed subtotal
   (Inkress will add fees). Operator can edit anything.
3. **Close out** (the three modes above). On "send link" / "take now":
   `POST /checkout/sessions` with `{ products:[{id,quantity}], customer,
   currency_code, title, reference_id: <draft id> }`. On "cash": `POST
   /orders` direct.
4. **Track**: the order list shows drafts (open), awaiting-payment
   (session issued, polled/webhooked), and paid (live Inkress order).
   Paid orders deep-link to the Inkress order.

## Views

- **New order** — product search + cart + customer + close-out.
- **Orders** — drafts / awaiting payment / paid, with filters; detail
  view per order (lines, customer, payment status, link, attribution).
- **Settings** — default currency, who can take payment, SES sender,
  WhatsApp number for "copy message".

## Platform mapping

| Need | Source |
|---|---|
| Product catalogue + prices | Inkress `GET /products` |
| Payment link / hosted checkout | Inkress `POST /checkout/sessions` → `payment_url`/`frame_url` |
| Cash/in-person order | Inkress `POST /orders` (direct) |
| Customer create | implicit via `customer{}` on session/order |
| Delivering the link | app: SES email + WhatsApp copy |
| Fulfillment status | Inkress `PATCH /orders/:id` |
| Draft + awaiting state | app SQLite (until paid) |

## Data integrity rules

- Never write a live Inkress order just to "hold" a phone order — use a
  session. Live orders are created by payment.
- `reference_id` on the session = the app draft id, unique, so the
  webhook/poll can reconcile draft → order without duplicates.
- After payment, treat the Inkress order as source of truth: the app
  mirrors status, never edits lines/total.
- Idempotency: issuing a link twice for the same draft reuses/replaces
  the session; never creates two orders.

## Definition of done

- Operator builds a cart from real products, sends a working pay link by
  email, and the customer paying produces a real Inkress order tied to
  the draft.
- "Take payment now" opens a working hosted checkout.
- "Cash" creates a real paid Inkress order.
- Orders list reflects real payment state; paid orders link into Inkress.
- No phantom/duplicate orders; immutable fields never touched.
