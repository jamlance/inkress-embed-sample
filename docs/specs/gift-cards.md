# Spec — Gift Cards

## The questions you asked

- **Where are the QR codes?** Every card has a QR encoding its public
  view URL (`/card/{code}`). On the printable card and the digital card.
- **Why a single page?** It isn't anymore: Overview, Cards (list +
  detail with balance/ledger), Sell, Designs, Settings.
- **Designs / their own images & logos?** A design picker: merchant
  uploads their logo + a cover image (stored in Bookerva S3) and picks a
  colour theme; the printable + digital + public card use it. Not a flat
  colourless print.
- **Print in colour?** Yes, the card renders the merchant's theme + cover
  image; print stylesheet preserves colour.
- **Which user did things?** Issuing, selling, and manual balance
  adjustments record the acting user + time; shown in the card's ledger.

## Why a merchant uses it

"Sell gift cards as a real product (paid for through my Inkress account),
hand customers a branded card with a QR, let the recipient check their
balance online, and redeem at checkout, with a clear ledger of who sold
/ issued / redeemed."

## Workflow

- **Sell a card** (paid): create an Inkress **checkout session** for the
  card amount; on payment the card is activated (webhook). The buyer gets
  a branded digital card (email via SES) + QR; recipient name/message
  optional.
- **Issue a card** (comp/manual): activate directly without payment
  (e.g. refund-as-credit, promo), attributed to the issuing user.
- **Redeem**: at the counter the operator scans/enters the code, sees the
  balance, applies an amount; the ledger debits. (Checkout integration:
  a `/api/validate` endpoint the merchant's checkout can call.)
- **Public card view** (`/card/{code}`, no auth): recipient sees the
  branded card, current balance, and ledger of redemptions (amounts only).

## Views

- **Overview** — issued / active / outstanding balance, recent activity.
- **Cards** — list + per-card detail (status, balance, buyer/recipient,
  full ledger with attribution) + reprint + resend.
- **Sell** — amount, recipient, message, design → checkout link / digital
  send.
- **Designs** — logo + cover upload (S3), theme colour, live preview of
  printable + digital + public card.
- **Settings** — expiry policy, who can issue/redeem.

## Platform mapping

| Need | Source |
|---|---|
| Selling a card for money | Inkress `POST /checkout/sessions` |
| Card branding assets | Bookerva S3 storage |
| Card record + balance + ledger | app SQLite |
| QR | render from `/card/{code}` |
| Digital delivery | SES |
| Who issued/sold/redeemed | app attribution |

## Data integrity

- A *sold* card only activates on real payment (session→webhook); never
  pre-activated. *Issued* (comp) cards are explicit, attributed, and
  flagged as non-revenue.
- Balance changes are append-only ledger entries; balance is derived,
  not overwritten. Redemption can't exceed balance.

## Definition of done

- Sell flow produces a real Inkress payment; paying activates a branded
  card with QR; recipient opens the public card and sees the balance;
  redeeming debits the ledger; reprint/resend work; designs use the
  merchant's logo/cover in colour; every action is attributed.
