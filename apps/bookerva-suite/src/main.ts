import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

/**
 * Bookerva Suite — 9 booking verticals from one deploy, path-routed.
 * Each vertical reuses the same scheduling backend (services +
 * bookings) but tunes the labels, resource term, and the extra detail
 * field to its trade. Terracotta-branded (data-brand="bookerva").
 */
interface Vertical {
  key: string; title: string; sub: string;
  resourceLabel: string | null;  // e.g. "Stylist", "Bay", "Tutor"
  detailLabel: string | null;    // extra per-booking field
  serviceLabel: string;          // "Service" vs "Class" vs "Job"
}
const VERTICALS: Record<string, Vertical> = {
  basic:     { key: "basic", title: "Appointments", sub: "simple bookings for any service business", resourceLabel: null, detailLabel: "Notes", serviceLabel: "Service" },
  tradesman: { key: "tradesman", title: "Tradesman Jobs", sub: "schedule site visits and quote jobs", resourceLabel: "Crew", detailLabel: "Job address", serviceLabel: "Job type" },
  salon:     { key: "salon", title: "Salon & Barber", sub: "book clients with the right stylist", resourceLabel: "Stylist", detailLabel: "Notes", serviceLabel: "Service" },
  auto:      { key: "auto", title: "Auto Service", sub: "service bookings with vehicle details", resourceLabel: "Bay", detailLabel: "Vehicle (make / plate)", serviceLabel: "Service" },
  tuition:   { key: "tuition", title: "Tuition & Classes", sub: "schedule lessons and classes", resourceLabel: "Tutor", detailLabel: "Subject / level", serviceLabel: "Class" },
  gym:       { key: "gym", title: "Studio & Gym", sub: "class bookings and memberships", resourceLabel: "Instructor", detailLabel: "Notes", serviceLabel: "Class" },
  photo:     { key: "photo", title: "Photography", sub: "session bookings with shoot details", resourceLabel: "Photographer", detailLabel: "Shoot location / brief", serviceLabel: "Session type" },
  cleaning:  { key: "cleaning", title: "Cleaning Service", sub: "recurring and one-off cleanings", resourceLabel: "Cleaner", detailLabel: "Property address", serviceLabel: "Service" },
  catering:  { key: "catering", title: "Catering", sub: "event catering bookings and quotes", resourceLabel: "Team", detailLabel: "Event details / guest count", serviceLabel: "Package" },
};
function detectVertical(): Vertical {
  const seg = location.pathname.split("/").filter(Boolean)[0] || "basic";
  return VERTICALS[seg] || VERTICALS.basic;
}

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant", currency = "JMD";
let V: Vertical;

interface Svc { id: number; name: string; duration_min: number; price: number; currency: string; resource: string | null; }
interface Booking { id: number; service_name: string | null; customer: string; contact: string | null; starts_at: string; resource: string | null; detail: string | null; status: string; }
let services: Svc[] = [];

(async () => {
  V = detectVertical();
  let session;
  try { session = await initBv(); }
  catch (err: any) { root.innerHTML = fatal(V.title, err?.message); return; }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  currency = session.merchant.currency_code || "JMD";
  renderShell();
  await Promise.all([loadServices(), loadBookings()]);
})();

function renderShell() {
  root.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div><h1>${esc(V.title)}</h1><p class="bv-muted">${esc(merchantName)} · ${esc(V.sub)}</p></div>
        <span class="bv-pill">Bookerva</span>
      </header>
      <div id="stats" class="bv-grid bv-grid-3" style="margin-bottom:16px;">${statSkel(3)}</div>
      <div class="bv-grid bv-grid-2" style="margin-bottom:16px;align-items:start;">
        <div class="bv-card">
          <h2 style="margin-top:0;">New booking</h2>
          <form id="bk-form" class="bv-stack">
            <div class="bv-grid bv-grid-2">
              <div><label class="bv-label">Customer</label><input id="b-customer" placeholder="Name" /></div>
              <div><label class="bv-label">Contact</label><input id="b-contact" placeholder="Phone / email" /></div>
            </div>
            <div class="bv-grid bv-grid-2">
              <div><label class="bv-label">${esc(V.serviceLabel)}</label><select id="b-service"></select></div>
              <div><label class="bv-label">Date &amp; time</label><input id="b-time" type="datetime-local" /></div>
            </div>
            ${V.resourceLabel ? `<div><label class="bv-label">${esc(V.resourceLabel)}</label><input id="b-resource" placeholder="${esc(V.resourceLabel)}" /></div>` : ""}
            ${V.detailLabel ? `<div><label class="bv-label">${esc(V.detailLabel)}</label><input id="b-detail" placeholder="${esc(V.detailLabel)}" /></div>` : ""}
            <div class="bv-row"><button type="submit" class="primary">Book it</button></div>
          </form>
        </div>
        <div class="bv-card">
          <h2 style="margin-top:0;">${esc(V.serviceLabel)}s</h2>
          <form id="sv-form" class="bv-row" style="margin-bottom:10px;flex-wrap:wrap;">
            <input id="s-name" placeholder="${esc(V.serviceLabel)} name" style="flex:1;min-width:120px;" />
            <input id="s-dur" type="number" placeholder="Mins" value="30" style="width:80px;" />
            <input id="s-price" type="number" step="0.01" placeholder="Price" style="width:100px;" />
            <button type="submit" class="primary">Add</button>
          </form>
          <div id="svc-list"></div>
        </div>
      </div>
      <h2 class="bv-section-title">Bookings</h2>
      <div id="bookings" class="bv-card"><div class="bv-skeleton" style="width:60%;"></div></div>
    </div>`;
  document.getElementById("bk-form")!.addEventListener("submit", onBook);
  document.getElementById("sv-form")!.addEventListener("submit", onAddService);
}

async function loadServices() {
  try {
    const { services: ss } = await bvApi<{ services: Svc[] }>(`/api/services?vertical=${V.key}`);
    services = ss;
    const sel = document.getElementById("b-service") as HTMLSelectElement;
    sel.innerHTML = `<option value="">— none —</option>` + ss.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.duration_min}m${s.price ? `, ${money(s.price, s.currency)}` : ""})</option>`).join("");
    const list = document.getElementById("svc-list")!;
    list.innerHTML = ss.length ? ss.map((s) => `<div class="bv-row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid hsl(var(--border));">
      <span>${esc(s.name)} <span class="bv-muted">· ${s.duration_min}m${s.price ? ` · ${money(s.price, s.currency)}` : ""}</span></span>
      <button data-del-svc="${s.id}" class="destructive">✕</button></div>`).join("") : `<div class="bv-muted">No ${V.serviceLabel.toLowerCase()}s yet.</div>`;
    list.querySelectorAll<HTMLButtonElement>("button[data-del-svc]").forEach((b) => b.addEventListener("click", async () => {
      await bvApi(`/api/services/${b.dataset.delSvc}`, { method: "DELETE" }); await loadServices(); }));
  } catch (err: any) { /* services optional */ }
}

async function loadBookings() {
  try {
    const { bookings, stats } = await bvApi<{ bookings: Booking[]; stats: any }>(`/api/bookings?vertical=${V.key}`);
    document.getElementById("stats")!.innerHTML =
      statCard("Upcoming", String(stats.upcoming)) + statCard("Total bookings", String(stats.total)) + statCard(`${V.serviceLabel}s`, String(stats.services));
    const el = document.getElementById("bookings")!;
    if (!bookings.length) { el.innerHTML = `<div class="bv-empty">No bookings yet. Create one above.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>When</th><th>Customer</th><th>${esc(V.serviceLabel)}</th>${V.resourceLabel ? `<th>${esc(V.resourceLabel)}</th>` : ""}<th>Status</th><th></th></tr></thead>
      <tbody>${bookings.map((b) => `<tr>
        <td>${esc(fmtDt(b.starts_at))}</td>
        <td><strong>${esc(b.customer)}</strong>${b.contact ? `<div class="bv-muted">${esc(b.contact)}</div>` : ""}${b.detail ? `<div class="bv-muted">${esc(b.detail)}</div>` : ""}</td>
        <td class="bv-muted">${esc(b.service_name || "—")}</td>
        ${V.resourceLabel ? `<td class="bv-muted">${esc(b.resource || "—")}</td>` : ""}
        <td><span class="bv-pill" data-tone="${b.status === "booked" ? "primary" : b.status === "completed" ? "success" : "destructive"}">${esc(b.status)}</span></td>
        <td style="text-align:right;white-space:nowrap;">
          ${b.status === "booked" ? `<button data-act="completed" data-id="${b.id}">Done</button><button data-act="cancelled" data-id="${b.id}">Cancel</button>` : ""}
          <button data-act="del" data-id="${b.id}" class="destructive">✕</button>
        </td></tr>`).join("")}</tbody></table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", async () => {
      try { if (b.dataset.act === "del") await bvApi(`/api/bookings/${b.dataset.id}`, { method: "DELETE" });
        else await bvApi(`/api/bookings/${b.dataset.id}`, { method: "PATCH", body: JSON.stringify({ status: b.dataset.act }) });
        await loadBookings(); } catch (err: any) { toast(err?.message || "error", "error"); } }));
  } catch (err: any) { document.getElementById("bookings")!.innerHTML = `<div class="bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`; }
}

async function onBook(e: Event) {
  e.preventDefault();
  const body: any = {
    vertical: V.key,
    customer: (document.getElementById("b-customer") as HTMLInputElement).value,
    contact: (document.getElementById("b-contact") as HTMLInputElement).value || null,
    service_id: (document.getElementById("b-service") as HTMLSelectElement).value || null,
    starts_at: new Date((document.getElementById("b-time") as HTMLInputElement).value || Date.now()).toISOString(),
  };
  const r = document.getElementById("b-resource") as HTMLInputElement | null;
  const d = document.getElementById("b-detail") as HTMLInputElement | null;
  if (r) body.resource = r.value || null;
  if (d) body.detail = d.value || null;
  try { await bvApi("/api/bookings", { method: "POST", body: JSON.stringify(body) });
    toast("Booked", "success"); (document.getElementById("bk-form") as HTMLFormElement).reset(); await loadServices(); await loadBookings(); }
  catch (err: any) { toast(err?.message || "Couldn't book", "error"); }
}

async function onAddService(e: Event) {
  e.preventDefault();
  const body = {
    vertical: V.key,
    name: (document.getElementById("s-name") as HTMLInputElement).value,
    duration_min: (document.getElementById("s-dur") as HTMLInputElement).value || 30,
    price: (document.getElementById("s-price") as HTMLInputElement).value || 0,
    currency,
  };
  try { await bvApi("/api/services", { method: "POST", body: JSON.stringify(body) });
    toast(`${V.serviceLabel} added`, "success"); (document.getElementById("sv-form") as HTMLFormElement).reset();
    (document.getElementById("s-dur") as HTMLInputElement).value = "30"; await loadServices(); await loadBookings(); }
  catch (err: any) { toast(err?.message || "error", "error"); }
}

function fmtDt(iso: string) { try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; } }
function statCard(l: string, v: string) { return `<div class="bv-card"><div class="bv-label">${esc(l)}</div><div style="font-size:24px;font-weight:600;">${esc(v)}</div></div>`; }
function statSkel(n: number) { return Array.from({ length: n }).map(() => `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div><div class="bv-skeleton" style="height:24px;width:40%;margin-top:6px;"></div></div>`).join(""); }
function money(n: number, c: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n || 0); } catch { return `${(n || 0).toFixed(2)} ${c}`; } }
function fatal(t: string, m?: string) { return `<div class="bv-shell"><div class="bv-card" style="text-align:center;"><h1>${esc(t)} couldn't load</h1><p class="bv-muted">${esc(m || "Unknown error")}</p></div></div>`; }
function esc(s: string) { return String(s ?? "").replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"); }
