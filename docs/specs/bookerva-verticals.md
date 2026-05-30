# Spec — Bookerva booking verticals (9 apps, 1 deploy)

basic · tradesman · salon · auto · tuition · gym · photo · cleaning · catering

## What this is

Nine Inkress-embedded dashboards, each tailored to one service trade,
all reading and writing **one merchant's real Bookerva tenant**. Not a
homegrown scheduler. The merchant's customers book through **Bookerva's
own public booking page**; the merchant runs their day from the embedded
app inside Inkress.

## Why a merchant uses it (the value)

"I sell my time. I need customers to book themselves without calling me,
I need to see today's schedule and this week's calendar, assign the right
staff member, get reminders sent automatically, take the deposit/payment
through my Inkress account, and handle the parts unique to my trade
(a vehicle's plate, a gallery to deliver, a recurring weekly clean)."

Bookerva already does the booking, availability, calendar, staff,
notifications, payments, and storage. The app makes that usable *inside
Inkress*, tuned to the trade.

## Platform mapping (what comes from where)

| Capability | Source |
|---|---|
| Public customer booking page | **Bookerva** `/book/{slug}` (link + QR + embed) |
| Services & options (variants) | **Bookerva** services + service-options |
| Availability / slots | **Bookerva** availability engine |
| Calendar (day/week/month) | **Bookerva** appointments → we render views; deep-link to Bookerva calendar for Google Meet/Zoom |
| Staff / providers / time-off | **Bookerva** team |
| Booking confirmation + reminder emails | **Bookerva** notifications (email/SMS/WhatsApp) |
| Taking payment / deposit | **Bookerva** → **Inkress** order (existing `merchantPaymentAccount` link) |
| Intake fields per trade | **Bookerva** intake-forms |
| File/photo storage + delivery | **Bookerva** S3 storage |
| Tenant for this merchant | resolved from Inkress `merchants.data.bookerva_id`; auto-provisioned if absent |

## Integration

1. On first open, the app backend reads the Inkress merchant
   (`merchants/:id`) → `data.bookerva_id`. If present, that's the tenant.
   If absent, call Bookerva to provision a tenant (signup path:
   slug from merchant username, name, currency, timezone) and write the
   `bookerva_id` back to Inkress merchant `data`.
2. Bookerva gains a **service-token auth** for our backend (mirrors its
   public-token JOSE pattern, but scoped `partner:read partner:write`
   for a tenant). Our backend mints it server-side with a shared secret
   we add to Bookerva, then calls the tRPC/REST endpoints on the
   merchant's behalf. (Edit Bookerva: add `app/kernel/service-token` +
   a thin REST surface for the dashboard ops we need — appointments
   list/create/transition, services CRUD, team, settings.)
3. All customer self-booking stays on Bookerva's public page; the app
   never reimplements availability.

## Views (shared shell, per-vertical sections)

Tabs: **Today** · **Calendar** · **Bookings** · **Services** ·
**Staff** · **Booking page** · **Settings** (+ a vertical tab, below).

- **Today** — next appointments, check-in/done/cancel, day total, who's
  on, deposits due.
- **Calendar** — week + month grid of appointments (from Bookerva),
  click a slot to view/create; "Open in Bookerva calendar" for
  Meet/Zoom sync.
- **Bookings** — full list + detail (customer, service, staff, intake
  answers, payment status, history), reschedule/cancel (writes Bookerva).
- **Services** — Bookerva services + options + price + duration; push to
  the booking page.
- **Staff** — Bookerva providers: who offers what, working hours,
  time-off. Assign staff to bookings.
- **Booking page** — the public `/book/{slug}` link + QR + "embed on my
  site" snippet + preview.
- **Settings** — hours, reminder timing, deposit %, intake form per
  service.

## Per-vertical specifics (this is the differentiation)

- **basic** — generic appointments. Minimal extra fields. Accent: slate.
- **tradesman** (amber) — **Quotes**: build a line-item quote → send as
  an Inkress checkout link for the deposit; job address + access notes;
  crew assignment; "on my way" SMS. Job sheet PDF.
- **salon** (plum) — book by **specific stylist**; per-stylist service
  menu + commission; client history (last service, formula notes via
  intake); no-show deposit.
- **auto** (steel) — **vehicle profile** (make/model/year/plate, VIN);
  service **bay** as the resource; parts + labour lines on the quote;
  service history per vehicle; pickup-ready SMS.
- **tuition** (green) — **students & terms**; recurring weekly lessons;
  per-subject/level; attendance; parent contact; term invoicing.
- **gym** (violet) — **classes** with capacity + waitlist; memberships
  (recurring via Inkress); class roster + check-in; instructor per class.
- **photo** (indigo) — **shoot booking** with deposit; after the shoot,
  a **gallery**: upload images (Bookerva S3), client views a
  password-protected gallery on a public page, favourites, **download
  ZIP** of selected/all; print/file upsell as Inkress checkout. Job
  pages per shoot (brief, location, shot list).
- **cleaning** (teal) — **recurring plans** (weekly/biweekly/monthly)
  with a schedule the customer can "skip this week"; **staff/cleaner
  assignment + route for the day**; property address + access/keys +
  checklist per property; per-visit completion with photos.
- **catering** (rust) — **event quote** (guest count → menu → itemized
  quote) sent as Inkress checkout for deposit, balance due N days before;
  event date/venue/headcount; dietary notes (intake); prep timeline.

## Data integrity

- Appointments, services, staff are **Bookerva's** records. The app does
  not keep a parallel copy; it reads/writes Bookerva. Local SQLite only
  caches merchant branding for fast public-page render and stores
  app-only extras Bookerva doesn't model yet (until added to Bookerva).
- Payments/deposits go through Bookerva→Inkress (existing link) or, for
  app-built quotes (tradesman/catering), an Inkress **checkout session**
  whose `reference_id` ties back to the Bookerva appointment.
- Galleries live in Bookerva S3; the app stores only the gallery's keys
  + access token.

## Definition of done (per vertical)

- Merchant can: see today + week calendar of real appointments; create/
  reschedule/cancel (reflected in Bookerva); manage services + staff;
  copy/share/QR the public booking page; configure hours + reminders.
- A customer can open the booking link with no account and book, getting
  a confirmation email (Bookerva).
- The vertical's named feature works end-to-end (e.g. photo gallery
  upload→client download ZIP; cleaning recurring plan with skip; auto
  vehicle profile on the booking; tradesman/catering quote→deposit link).
- Bookings show attribution + payment status.
