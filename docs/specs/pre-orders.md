# Spec — Pre-orders

## Why a merchant uses it

"Sell something before it's in stock: take real deposits now, let
customers reserve from a public page, charge the balance when it lands,
and only ship if I hit my target, all settling into my Inkress account."

## Workflow

- **Campaign**: product name + image, deposit amount, full price, target
  qty, available-on date, deposit-only vs pay-in-full.
- **Public reserve page** (`/preorder/{campaign}`, no auth): customer sees
  the product (merchant branding), reserves by paying the **deposit**
  through an Inkress **checkout session**; on payment the reservation is
  confirmed (webhook). Progress bar toward target.
- **Fulfilment**: when stock lands, the app charges the **balance** —
  generates a balance checkout link per reservation and sends it (SES);
  on payment the order completes. If the campaign misses target by the
  date, deposits are refunded (Inkress refund) and customers notified.
- **Merchant views**: Overview (reserved units, deposits collected,
  progress), Reservations (list + detail + balance state + attribution),
  Campaign settings.

## Platform mapping

| Need | Source |
|---|---|
| Deposit + balance payment | Inkress `POST /checkout/sessions` (two sessions: deposit, balance) |
| Reservation confirm | payment webhook |
| Refund on miss | Inkress refund |
| Product image | Bookerva S3 |
| Public page | app, no auth |
| Reservations, progress | app SQLite, keyed to sessions |

## Data integrity

- Deposit and balance are separate sessions; reservation tracks both
  `reference_id`s. No live order until paid. Target/availability never
  silently overshoot capacity.

## Definition of done

- Public page takes a real deposit; reservation confirmed on payment;
  balance link charges later; progress + attribution accurate; miss-path
  refunds.
