# Spec — Order Tagger

## The questions you asked

- **Are the orders actually updated?** Yes. Tags are written back to the
  Inkress order's `meta_data` (the mutable metadata field — never touches
  lines/total/status, which Inkress freezes). A tag is real data on the
  order, visible to anything reading that order, not an app-only label.
- **Can you view an order?** Yes. The tagger lists real orders and opens
  a **full order detail** (customer, lines, totals, status, current tags,
  history) and deep-links to the order in the Inkress dashboard.
- **Which user tagged things?** Every tag records the acting dashboard
  user + timestamp (attribution headers), shown on the tag and in the
  order's tag history.

## Why a merchant uses it

"I want to label orders by rules I set, VIP, wholesale, fraud-check,
gift, so I can find and act on them later, and I want it to actually live
on the order, not in a separate tool. And I want auto-tagging so I don't
do it by hand."

## Workflow

1. **Rules** — define rules: `when total ≥ X` / `status is Y` / `customer
   is repeat` / `currency is Z` → apply tag `<label>`. Rules run on new
   paid orders (webhook) and on demand.
2. **Live tagging** — the orders list shows each recent order with its
   computed + manual tags; operator can add/remove tags inline.
3. **Order detail** — open any order: full lines/customer/status, the
   tags with who/when, and a deep link to Inkress.
4. **Write-back** — adding/removing a tag does `PATCH /orders/:id` with a
   merged `meta_data.tags` array + a `meta_data.tag_log` entry
   `{label, by, at, action}`.

## Views

- **Orders** — list with tags, filter by tag/status/value, search.
- **Order detail** — full order + tag editor + history + Inkress link.
- **Rules** — auto-tag rules CRUD + "apply to last 50".

## Platform mapping

| Need | Source |
|---|---|
| Orders + lines + customer | Inkress `GET /orders`, `GET /orders/:id` |
| Persist a tag on the order | Inkress `PATCH /orders/:id` (`meta_data`) |
| Auto-tag on new orders | Inkress webhook `orders.paid` → run rules |
| Who tagged | app attribution headers |
| Rules | app SQLite |

## Data integrity

- Tags live in `meta_data` only. Lines, total, customer_id, currency,
  reference_id, status are never modified by this app.
- Tag writes are merge-not-replace on `meta_data.tags`; concurrent tags
  from two staff don't clobber.

## Definition of done

- Apply a tag → re-fetch the order from Inkress → the tag is present in
  `meta_data`. Auto-rule tags new paid orders. Order detail shows real
  lines + tag history with attribution. Removing a tag persists.
