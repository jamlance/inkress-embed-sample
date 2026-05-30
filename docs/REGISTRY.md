# App registry — 28 embedded apps across 7 deploys

All apps are registered as Inkress OAuth clients (embedded=true,
status=active) and auto-connected to the test merchant
**bookerva-jackjack (merchant 183)** on dev. Open any via the
dashboard sidebar (Apps section) or directly at
`https://dev.inkress.com/dashboard/apps/<client_id>`.

Full data chain is verified working (session JWT → RFC 8693 exchange →
live Inkress reads). See `scripts/verify-app.mjs`.

## Deploy topology

| Deploy (Coolify) | Listings | Routing |
|---|---|---|
| 10 standalone apps | 1 each | one app per deploy |
| `bookerva-render-suite` | 4 | path-routed: /invoices /receipts /donations /gift-cards |
| `bookerva-automation-suite` | 5 | path-routed: /digest /birthdays /tagger /restock /wa-updates |
| `bookerva-suite` | 9 | path-routed: /basic /tradesman /salon /auto /tuition /gym /photo /cleaning /catering |

13 deploys would have been the max; suites collapse 18 listings into 3
deploys, so the real total is **7 backend deploys** for 28 listings.

## Bookerva Org (9 — booking verticals, terracotta brand)

| App | client_id | URL |
|---|---|---|
| Bookerva Appointments | inkid_S0ERTtG222YGFaBntzyJeA | …/basic |
| Bookerva Tradesman | inkid_OLTD3k8PtKGn7Tao76V_Gg | …/tradesman |
| Bookerva Salon & Barber | inkid_smVRFvo7HKdX4ZB0q17USQ | …/salon |
| Bookerva Auto Service | inkid_gSZiLwH0PuUDa6_WNW0rnA | …/auto |
| Bookerva Tuition | inkid_lT0zzoXLEOuZHTm18ir3NQ | …/tuition |
| Bookerva Studio & Gym | inkid_i_i8HeDckIq0NdvHI075Iw | …/gym |
| Bookerva Photography | inkid_eyvyg1r1nz3Uaj4AFLuOUw | …/photo |
| Bookerva Cleaning | inkid_PG7nZVsZDcTjDyzM5gPSWw | …/cleaning |
| Bookerva Catering | inkid_56ebaOx2Fyk9LfNhyvGUjg | …/catering |

All nine serve from `kowggc4ko0g0wc4o000kwswo.dserve.webapps.host`.
Self-contained scheduling backend (services + bookings, vertical-scoped).
**Note:** these do NOT yet read Bookerva's real appointment data — that
deeper integration (Inkress access-token → Bookerva session exchange)
is the documented follow-up; tonight they ship as standalone,
Bookerva-branded booking apps.

## Marketplace Org (19)

### Standalone (10)

| App | client_id | Host |
|---|---|---|
| Currency Dashboard | inkid_wEve2f7qSBwu4_UxCYl4sA | cg4o48gwgcskk48skg84csko |
| Promo Codes | inkid_EZcJA4DClGZPwgFtIcCAEA | to0o0os0ock8sskk8w0cgk4o |
| Expense Logger | inkid_mwlTrvM8m6-c3-TPW2Jx8Q | es4080ocsooc4ss4kwgowksw |
| Gift Registry | inkid_EmEZHZ1dzevPoaIFl74gvg | b0gccw8wkkc888o4ckoo88ok |
| Event Tickets | inkid_V5TfBEmKfj4CjYLnJmpk-g | p4s8gg8goc40s0ww8444sg4o |
| Subscription Boxes | inkid_kVvN_Kn9ItbkGkyv6HyqOg | akgokk0ggkk808gcgc4gw4ko |
| Restaurant Menu | inkid_eo0nZtDDMMet9-5ssLGBMA | p48cc84sk4g400wk0gg8swss |
| Pre-orders | inkid_xjkQMKCbqbw1yX606sGmtg | n4kw4g4k8ccgoow000g0s0o0 |
| Document Vault | inkid_i9UTQTJnAuWDBs8GsScL2A | ekokgcwkgw0gww4w4soccc84 |
| Phone Order Taker | inkid_oi1GKMjkbLF8unh85mhe1A | zskgk8k4cssoc04gwg4kog8k |

### Render Suite (4 — `l0skw000kscog8occw48coco`)

| App | client_id | Path |
|---|---|---|
| Invoices | inkid_xJSCqub_I83EZYdnPPGzSQ | /invoices |
| Receipts | inkid_SvFCw3gXulhthNk7_5S2aw | /receipts |
| Donation Receipts | inkid_oR_4pB7HcFfW3g4vaSxwig | /donations |
| Gift Cards | inkid_on2vKpK58iCe31uhAiP8PA | /gift-cards |

Browser print-to-PDF (no Chromium in the container). Invoices/receipts
read live Inkress orders; donations + gift-cards persist locally.

### Automation Suite (5 — `zc0wcwgkswkwkcsgk4ggscw0`)

| App | client_id | Path |
|---|---|---|
| Daily Sales Digest | inkid_Td_Zq3fxKZv5LxtnCVAf5w | /digest |
| Birthday Promotions | inkid_QjMoQQ646Y09paLfxNQdDQ | /birthdays |
| Order Tagger | inkid_j3uPpBosiGoPbtyXq4AXYw | /tagger |
| Back-in-Stock Alerts | inkid_uubAvKddXtbgqNWQp_L39g | /restock |
| Order Update Messages | inkid_6VO3Mv9B7KwY-wCANAwfyw | /wa-updates |

Email via AWS SES (sender `noreply@bookerva.com`, verified, production
access). WhatsApp delivery is stubbed pending a WhatsApp Business
pairing step — the routes + config UI are in place.

## Notes / follow-ups

- **Bookerva backend integration** — the 9 verticals currently use a
  self-contained scheduler. Wiring them to Bookerva's real appointment
  engine needs the Inkress→Bookerva token exchange (mirror of the
  Inkress-side flow we built). Designed but not yet implemented.
- **WhatsApp delivery** — Automation suite's wa-updates + birthday/
  digest channels send by email today. WhatsApp needs whatsapp-web.js
  (Chromium) or the Meta WhatsApp Business API; deferred to keep the
  containers lean.
- **Re-review gate** — all apps were registered directly as
  status=active (bulk script) rather than going through the
  pending_review flow, since this is dev. Production registration
  should go through the dashboard's review flow.
