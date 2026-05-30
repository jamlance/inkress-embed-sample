# Spec — Automation suite (Daily Digest · Birthdays · Back-in-Stock · Order Update Messages)

(Order Tagger, the 5th, has its own spec.)

All four send real messages. Email is **AWS SES** (verified sender on
`bookerva.com`, production access). WhatsApp/SMS where the merchant has a
channel; until then email is the channel and the UI says so honestly.
Each app is multi-view with a **send log** (who/what/when/result), not a
single button.

## Daily Sales Digest

**You said:** does nothing, no email arrives, no filtering, no preview,
one button, not prefilled with the store's people, not fleshed out.

**Fix — real app:**
- **Preview** tab: renders the actual digest for a chosen date/range and
  currency (revenue, orders, AOV, top products, biggest order, new
  customers, refunds, payouts). Real content, not a button.
- **Recipients** tab: prefilled with the merchant's **team/users**
  (from Inkress) + any addresses the owner adds; toggle who gets it.
- **Schedule** tab: daily/weekly, time of day, timezone; "send now."
- **Filters**: date range, currency, include/exclude sections.
- **Send log**: every send with recipients, status (SES message id),
  and who triggered manual sends.
- **Actually sends**: "Send now" delivers via SES to all enabled
  recipients; scheduled sends run on a cron (worker). Verify a real
  email lands.

## Birthday Promotions

- **Customers** tab: pulls the merchant's customers from Inkress; capture
  birthdays (Inkress custom field or app-side) and a discount code.
- **Templates**: a real, designed birthday email (merchant logo/colour),
  editable copy, preview.
- **Automation**: N days before a birthday, auto-send the email with the
  code; manual "send now" per customer.
- **Log**: who got what, when, opens if available.

## Back-in-Stock Alerts

- **Products** tab: live Inkress stock; mark products to watch with a
  threshold.
- **Customer waitlist**: a public "notify me" page (`/restock/{product}`,
  no auth) where a customer leaves email/WhatsApp; when stock crosses the
  threshold (webhook/poll on products), the app notifies the waitlist.
- **Log**: alerts fired, to whom.

## Order Update Messages

- **Events** tab: choose which order events (paid/shipped/refunded/
  cancelled) trigger a customer message; per-event template with merchant
  branding + order details + (optional) tracking.
- **Delivery**: subscribes to Inkress order webhooks; on event, sends the
  customer the message (SES now; WhatsApp when paired). The merchant's WA
  pairing is a real future step, surfaced honestly with status.
- **Log**: messages sent per order, status.

## Platform mapping

| Need | Source |
|---|---|
| Orders / customers / products / payouts | Inkress reads |
| Event triggers | Inkress webhooks (`orders.paid` etc.) |
| Team/users for recipients | Inkress |
| Email delivery | AWS SES (`noreply@bookerva.com`) |
| Scheduled sends | worker cron |
| Templates / assets | Bookerva S3 + app |
| Waitlist, logs, config | app SQLite |

## Data integrity / honesty

- Never claim WhatsApp delivery until a channel is paired; show channel
  status. Email always works.
- De-dupe: a customer never gets the same birthday/restock message twice;
  webhook idempotency keyed on event id.

## Definition of done

- Digest: real preview, team-prefilled recipients, working "send now"
  that lands in an inbox, schedule, send log.
- Birthdays: customer list, designed email, auto + manual send, log.
- Restock: watch products, public waitlist page, fire on restock, log.
- Order updates: pick events, branded message, fires on real webhook,
  log. All four show a truthful channel status.
