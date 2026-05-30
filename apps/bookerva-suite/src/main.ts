import "./index.css";
import {
  initBv, bvApi, h, mountShell, statRow, card, dataTable, emptyState,
  skeletonCard, pill, openModal, flash, fmtMoney, fmtDate, relTime, avatar,
  icon, type BvSession,
} from "@bookerva-apps/core/browser";

/* ---------- vertical config ---------- */
interface Vertical { key: string; title: string; icon: string; sub: string; resource: string | null; detail: string | null; svcWord: string; }
const VERTICALS: Record<string, Vertical> = {
  basic: { key: "basic", title: "Appointments", icon: "calendar", sub: "bookings for any service", resource: null, detail: "Notes", svcWord: "Service" },
  tradesman: { key: "tradesman", title: "Tradesman Jobs", icon: "wrench", sub: "site visits & quoted jobs", resource: "Crew", detail: "Job address", svcWord: "Job type" },
  salon: { key: "salon", title: "Salon & Barber", icon: "scissors", sub: "book clients with a stylist", resource: "Stylist", detail: "Notes", svcWord: "Service" },
  auto: { key: "auto", title: "Auto Service", icon: "car", sub: "service bay bookings", resource: "Bay", detail: "Vehicle (make / plate)", svcWord: "Service" },
  tuition: { key: "tuition", title: "Tuition & Classes", icon: "book", sub: "lessons & classes", resource: "Tutor", detail: "Subject / level", svcWord: "Class" },
  gym: { key: "gym", title: "Studio & Gym", icon: "dumbbell", sub: "class bookings", resource: "Instructor", detail: "Notes", svcWord: "Class" },
  photo: { key: "photo", title: "Photography", icon: "camera", sub: "shoot sessions", resource: "Photographer", detail: "Shoot location / brief", svcWord: "Session" },
  cleaning: { key: "cleaning", title: "Cleaning Service", icon: "sparkles", sub: "one-off & recurring", resource: "Cleaner", detail: "Property address", svcWord: "Service" },
  catering: { key: "catering", title: "Catering", icon: "chef", sub: "event catering", resource: "Team", detail: "Event details / guests", svcWord: "Package" },
};

interface Svc { id: number; name: string; duration_min: number; price: number; currency: string; resource: string | null; }
interface Booking { id: number; service_name: string | null; customer: string; contact: string | null; starts_at: string; resource: string | null; detail: string | null; status: string; source: string; created_by: string | null; }

const root = document.getElementById("root")!;

/* =========================================================== ROUTER */
const seg = location.pathname.split("/").filter(Boolean);
if (seg[0] === "book") {
  runPublic(Number(seg[1]), new URLSearchParams(location.search).get("v") || "basic");
} else {
  runMerchant();
}

/* =========================================================== MERCHANT */
async function runMerchant() {
  const v = pickVertical();
  let session: BvSession;
  try { session = await initBv(); }
  catch (err: any) { renderFatal(V().title, err?.message); return; }
  const merchantName = session.merchant.name || session.merchant.username || "Merchant";
  const currency = session.merchant.currency_code || "JMD";

  mountShell({
    brandIcon: v.icon, title: `Bookerva ${v.title}`, subtitle: merchantName, poweredBy: "Bookerva",
    tabs: [
      { id: "today", label: "Today", icon: "sunrise", render: (host) => tabToday(host, v) },
      { id: "bookings", label: "Bookings", icon: "calendar", render: (host) => tabBookings(host, v, currency) },
      { id: "services", label: `${v.svcWord}s`, icon: "tag", render: (host) => tabServices(host, v, currency) },
      { id: "share", label: "Booking page", icon: "link", render: (host) => tabShare(host, v) },
      { id: "settings", label: "Hours", icon: "clock", render: (host) => tabSettings(host, v) },
    ],
  });

  function pickVertical(): Vertical { return V(); }
  function V(): Vertical { const s = location.pathname.split("/").filter(Boolean)[0] || "basic"; return VERTICALS[s] || VERTICALS.basic; }
}

function V(): Vertical { const s = location.pathname.split("/").filter(Boolean)[0] || "basic"; return VERTICALS[s] || VERTICALS.basic; }

async function tabToday(host: HTMLElement, v: Vertical) {
  host.append(skeletonCard());
  try {
    const o = await bvApi<{ stats: any; next: Booking[]; share_url: string }>(`/api/overview?vertical=${v.key}`);
    host.innerHTML = "";
    host.append(statRow([
      { k: "Today's bookings", v: String(o.stats.today), icon: "sunrise", tone: "accent" },
      { k: "Upcoming", v: String(o.stats.upcoming), icon: "calendar" },
      { k: `${v.svcWord}s offered`, v: String(o.stats.services), icon: "tag" },
    ]));
    const list = o.next.length
      ? h("div", { class: "bv-stack" }, ...o.next.map((b) => h("div", { class: "bv-list-row" },
          h("div", null,
            h("div", { style: { fontWeight: "600" } }, b.customer, b.source === "online" ? pill("online", "primary") : null),
            h("div", { class: "bv-muted" }, [fmtDate(b.starts_at, true), b.service_name, b.resource].filter(Boolean).join(" · "))),
          h("div", { class: "bv-row" },
            h("button", { class: "sm", onClick: () => updateBooking(b.id, "completed", () => tabToday(host, v)) }, "Done"),
            h("button", { class: "sm ghost", onClick: () => updateBooking(b.id, "cancelled", () => tabToday(host, v)) }, "Cancel")))))
      : emptyState({ icon: "calendar", title: "Nothing booked yet", text: "Bookings will appear here. Share your booking page so customers can book themselves.", action: h("button", { class: "primary", onClick: () => (document.querySelector('[role=tab]:nth-child(4)') as HTMLElement)?.click() }, "Get my booking link") });
    host.append(card({ title: "Next up", body: list }));
  } catch (err: any) { host.innerHTML = ""; host.append(errCard(err)); }
}

async function tabBookings(host: HTMLElement, v: Vertical, currency: string) {
  host.append(card({ title: "All bookings", action: h("button", { class: "primary", onClick: () => newBookingModal(v, currency, () => tabBookings(host, v, currency)) }, icon("plus", 16), "New booking"), body: skeletonCard() }));
  try {
    const { bookings } = await bvApi<{ bookings: Booking[] }>(`/api/bookings?vertical=${v.key}`);
    host.innerHTML = "";
    const table = dataTable<Booking>({
      columns: [
        { head: "When", cell: (b) => h("div", null, h("div", { style: { fontWeight: "550" } }, fmtDate(b.starts_at, true))) },
        { head: "Customer", cell: (b) => h("div", null, h("div", null, b.customer), b.contact ? h("div", { class: "bv-muted" }, b.contact) : null) },
        { head: v.svcWord, cell: (b) => b.service_name || "—" },
        { head: "Status", cell: (b) => statusPill(b.status) },
        { head: "Source", cell: (b) => b.source === "online" ? pill("online", "primary") : pill("staff") },
      ],
      rows: bookings,
      onRowClick: (b) => bookingDetail(b, v, () => tabBookings(host, v, currency)),
      rowActions: (b) => b.status === "booked"
        ? h("span", null, h("button", { class: "sm", onClick: () => updateBooking(b.id, "completed", () => tabBookings(host, v, currency)) }, "Done"))
        : null,
      empty: emptyState({ icon: "calendar", title: "No bookings yet", text: "Create one, or share your booking page.", action: h("button", { class: "primary", onClick: () => newBookingModal(v, currency, () => tabBookings(host, v, currency)) }, "New booking") }),
    });
    host.append(card({ title: `All bookings (${bookings.length})`, action: h("button", { class: "primary", onClick: () => newBookingModal(v, currency, () => tabBookings(host, v, currency)) }, icon("plus", 16), "New booking"), body: table }));
  } catch (err: any) { host.innerHTML = ""; host.append(errCard(err)); }
}

async function tabServices(host: HTMLElement, v: Vertical, currency: string) {
  host.append(skeletonCard());
  const { services } = await bvApi<{ services: Svc[] }>(`/api/services?vertical=${v.key}`).catch(() => ({ services: [] }));
  host.innerHTML = "";
  const form = h("form", { class: "bv-row", style: { flexWrap: "wrap" }, onSubmit: async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const data = { vertical: v.key, name: (f.elements.namedItem("name") as HTMLInputElement).value, duration_min: (f.elements.namedItem("dur") as HTMLInputElement).value, price: (f.elements.namedItem("price") as HTMLInputElement).value, currency };
    try { await bvApi("/api/services", { method: "POST", body: JSON.stringify(data) }); flash(`${v.svcWord} added`, "success"); tabServices(host, v, currency); }
    catch (err: any) { flash(err?.message || "Couldn't add", "error"); }
  } },
    h("input", { name: "name", placeholder: `${v.svcWord} name`, style: { flex: "2", minWidth: "150px" } }),
    h("input", { name: "dur", type: "number", placeholder: "Mins", value: "30", style: { width: "90px" } }),
    h("input", { name: "price", type: "number", step: "0.01", placeholder: "Price", style: { width: "110px" } }),
    h("button", { class: "primary", type: "submit" }, icon("plus", 16), "Add"));

  const list = services.length
    ? dataTable<Svc>({
        columns: [
          { head: v.svcWord, cell: (s) => h("strong", null, s.name) },
          { head: "Duration", cell: (s) => `${s.duration_min} min` },
          { head: "Price", num: true, cell: (s) => s.price ? fmtMoney(s.price, s.currency) : "—" },
        ],
        rows: services,
        rowActions: (s) => h("button", { class: "sm danger", onClick: async () => { await bvApi(`/api/services/${s.id}`, { method: "DELETE" }); tabServices(host, v, currency); } }, "Remove"),
      })
    : emptyState({ icon: "tag", title: `No ${v.svcWord.toLowerCase()}s yet`, text: `Add the ${v.svcWord.toLowerCase()}s customers can book, with durations so slots are sized right.` });
  host.append(card({ title: `Add a ${v.svcWord.toLowerCase()}`, body: form }), card({ title: `Your ${v.svcWord.toLowerCase()}s`, body: list }));
}

async function tabShare(host: HTMLElement, v: Vertical) {
  host.append(skeletonCard());
  const o = await bvApi<{ share_url: string }>(`/api/overview?vertical=${v.key}`).catch(() => ({ share_url: "" }));
  host.innerHTML = "";
  const url = o.share_url;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=336x336&margin=8&data=${encodeURIComponent(url)}`;
  host.append(card({
    title: "Your public booking page",
    body: [
      h("p", { class: "bv-muted", style: { marginTop: "0" } }, "Share this link or QR with customers. They can browse your services and book a time themselves, with no account needed. New bookings show up under Today."),
      h("div", { class: "bv-row", style: { alignItems: "stretch" } },
        h("div", { class: "bv-pub-qr", style: { display: "grid", placeItems: "center" } }, h("img", { src: qr, width: "168", height: "168", style: { borderRadius: "12px", background: "#fff", padding: "8px", boxShadow: "var(--e1)" } })),
        h("div", { class: "bv-stack", style: { flex: "1", minWidth: "220px", justifyContent: "center" } },
          h("label", { class: "bv-label" }, "Booking link"),
          h("div", { class: "bv-row" }, h("input", { value: url, readonly: true, onFocus: (e: Event) => (e.target as HTMLInputElement).select(), style: { flex: "1" } }),
            h("button", { onClick: () => { navigator.clipboard?.writeText(url); flash("Link copied", "success"); } }, icon("link", 16), "Copy")),
          h("a", { href: url, target: "_blank", rel: "noreferrer" }, h("button", { class: "secondary" }, icon("eye", 16), "Preview booking page")))),
    ],
  }));
}

async function tabSettings(host: HTMLElement, v: Vertical) {
  host.append(skeletonCard());
  const { settings: s } = await bvApi<{ settings: any }>(`/api/settings?vertical=${v.key}`);
  host.innerHTML = "";
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const activeDays = new Set(String(s.days).split(",").map(Number));
  const form = h("form", { class: "bv-stack", style: { maxWidth: "520px" }, onSubmit: async (e: Event) => {
    e.preventDefault();
    const days = dayNames.map((_, i) => i).filter((i) => (host.querySelector(`#day-${i}`) as HTMLInputElement)?.checked).join(",");
    const data = { vertical: v.key, open_hour: (host.querySelector("#oh") as HTMLInputElement).value, close_hour: (host.querySelector("#ch") as HTMLInputElement).value, slot_min: (host.querySelector("#sm") as HTMLSelectElement).value, days };
    try { await bvApi("/api/settings", { method: "PUT", body: JSON.stringify(data) }); flash("Hours saved", "success"); }
    catch (err: any) { flash(err?.message || "error", "error"); }
  } },
    h("div", { class: "bv-row" },
      h("div", { class: "bv-field" }, h("label", { class: "bv-label" }, "Opens"), h("input", { id: "oh", type: "number", min: "0", max: "23", value: String(s.open_hour), style: { width: "90px" } })),
      h("div", { class: "bv-field" }, h("label", { class: "bv-label" }, "Closes"), h("input", { id: "ch", type: "number", min: "1", max: "24", value: String(s.close_hour), style: { width: "90px" } })),
      h("div", { class: "bv-field" }, h("label", { class: "bv-label" }, "Slot length"),
        h("select", { id: "sm", style: { width: "120px" } }, ...[15, 30, 45, 60, 90].map((m) => h("option", { value: String(m), selected: s.slot_min === m }, `${m} min`))))),
    h("div", null, h("label", { class: "bv-label" }, "Open days"),
      h("div", { class: "bv-row" }, ...dayNames.map((d, i) => h("label", { class: "bv-pill", style: { cursor: "pointer", padding: "6px 10px" } }, h("input", { id: `day-${i}`, type: "checkbox", checked: activeDays.has(i), style: { width: "auto", marginRight: "4px" } }), d)))),
    h("div", { class: "bv-row" }, h("button", { class: "primary", type: "submit" }, "Save hours")));
  host.append(card({ title: "Working hours", body: [h("p", { class: "bv-muted", style: { marginTop: 0 } }, "Customers can only book inside these hours, on open days. Slot length sets the booking grid; individual services can run longer."), form] }));
}

/* ---------- shared merchant helpers ---------- */
function statusPill(s: string) {
  return s === "booked" ? pill("Booked", "primary") : s === "completed" ? pill("Done", "ok", "check") : s === "no_show" ? pill("No-show", "warning") : pill("Cancelled", "bad");
}
async function updateBooking(id: number, status: string, after: () => void) {
  try { await bvApi(`/api/bookings/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); flash(status === "completed" ? "Marked done" : "Updated", "success"); after(); }
  catch (err: any) { flash(err?.message || "error", "error"); }
}
function bookingDetail(b: Booking, v: Vertical, after: () => void) {
  openModal({
    title: b.customer,
    body: h("div", { class: "bv-stack" },
      kv("When", fmtDate(b.starts_at, true)),
      b.service_name ? kv(v.svcWord, b.service_name) : null,
      b.contact ? kv("Contact", b.contact) : null,
      b.resource ? kv(v.resource || "Resource", b.resource) : null,
      b.detail ? kv(v.detail || "Detail", b.detail) : null,
      kv("Status", statusPill(b.status)),
      kv("Booked", h("span", null, b.source === "online" ? "online by customer" : `by ${b.created_by || "staff"}`, " · ", relTime((b as any).created_at || b.starts_at)))),
    actions: [
      { label: "Cancel booking", danger: true, onClick: () => { updateBooking(b.id, "cancelled", after); } },
      { label: "Mark done", primary: true, onClick: () => { updateBooking(b.id, "completed", after); } },
    ],
  });
}
function kv(k: string, v: any) { return h("div", { class: "bv-row", style: { justifyContent: "space-between", gap: "16px" } }, h("span", { class: "bv-label", style: { margin: 0 } }, k), h("span", null, v)); }

function newBookingModal(v: Vertical, currency: string, after: () => void) {
  bvApi<{ services: Svc[] }>(`/api/services?vertical=${v.key}`).then(({ services }) => {
    const body = h("form", { id: "nb", class: "bv-stack" },
      field("Customer name", h("input", { name: "customer", required: true })),
      field("Contact (phone / email)", h("input", { name: "contact" })),
      field(v.svcWord, h("select", { name: "service_id" }, h("option", { value: "" }, "— none —"), ...services.map((s) => h("option", { value: String(s.id) }, `${s.name} (${s.duration_min}m)`)))),
      field("Date & time", h("input", { name: "starts_at", type: "datetime-local", required: true })),
      v.resource ? field(v.resource, h("input", { name: "resource" })) : null,
      v.detail ? field(v.detail, h("input", { name: "detail" })) : null);
    openModal({ title: "New booking", body, actions: [
      { label: "Book it", primary: true, onClick: () => {
        const f = body as HTMLFormElement;
        const data: any = { vertical: v.key };
        for (const el of Array.from(f.elements) as HTMLInputElement[]) if (el.name) data[el.name] = el.value;
        if (!data.customer || !data.starts_at) { flash("Customer and time required", "warning"); return true; }
        data.starts_at = new Date(data.starts_at).toISOString();
        bvApi("/api/bookings", { method: "POST", body: JSON.stringify(data) }).then(() => { flash("Booked", "success"); after(); }).catch((err) => flash(err?.message || "error", "error"));
      } },
    ] });
  });
}
function field(label: string, input: Node) { return h("div", { class: "bv-field" }, h("label", { class: "bv-label" }, label), input); }

function errCard(err: any) { return card({ body: emptyState({ icon: "alert", title: "Couldn't load", text: err?.message || "Please reload." }) }); }
function renderFatal(title: string, msg?: string) {
  root.innerHTML = "";
  root.append(h("div", { class: "bv-fatal" }, h("div", { class: "box" },
    h("div", { class: "ic", html: icon("alert", 26) }), h("h1", null, `${title} couldn't load`), h("p", { class: "bv-muted" }, msg || "Open this app from your Inkress dashboard."))));
}

/* =========================================================== PUBLIC PAGE */
async function runPublic(mid: number, vKey: string) {
  document.documentElement.setAttribute("data-brand", "bookerva");
  root.innerHTML = `<div class="pub"><div class="pub-hero"><div class="bv-skeleton" style="width:120px;height:24px;margin:0 auto;"></div></div></div>`;
  let info: any;
  try { info = await fetch(`/api/public/${mid}/info?v=${vKey}`).then((r) => r.json()); }
  catch { info = null; }
  if (!info?.merchant) { root.innerHTML = `<div class="pub"><div class="pub-wrap" style="margin-top:40px;"><div class="pub-card" style="text-align:center;"><h2>Booking page unavailable</h2><p class="bv-muted">This link may be inactive.</p></div></div></div>`; return; }

  const m = info.merchant; const vc = VERTICALS[vKey] || VERTICALS.basic;
  const state: { service: Svc | null; date: string; slot: string | null } = { service: info.services[0] || null, date: new Date().toISOString().slice(0, 10), slot: null };

  const pub = h("div", { class: "pub" });
  const hero = h("div", { class: "pub-hero" },
    m.logo ? h("img", { class: "logo", src: m.logo, alt: m.name }) : h("div", { class: "logo", style: { display: "grid", placeItems: "center", fontSize: "26px", fontWeight: "800", color: "var(--accent)" } }, (m.name || "?").slice(0, 1)),
    h("h1", null, m.name || "Book an appointment"),
    h("p", null, `Book your ${vc.title.toLowerCase()} online`));
  const wrap = h("div", { class: "pub-wrap" });
  pub.append(hero, wrap, h("div", { class: "pub-foot" }, "powered by Bookerva · secured by Inkress"));
  root.innerHTML = ""; root.append(pub);

  function render() {
    wrap.innerHTML = "";
    // service select
    const svcCard = h("div", { class: "pub-card" },
      h("label", { class: "bv-label" }, "What do you need?"),
      info.services.length
        ? h("div", { class: "bv-stack" }, ...info.services.map((s: Svc) => h("button", {
            class: "bv-list-row" + (state.service?.id === s.id ? " is-active" : ""),
            style: { width: "100%", height: "auto", justifyContent: "space-between" },
            onClick: () => { state.service = s; state.slot = null; render(); },
          }, h("span", null, h("strong", null, s.name), h("div", { class: "bv-muted" }, `${s.duration_min} min`)), s.price ? h("span", { style: { fontWeight: "700" } }, fmtMoney(s.price, s.currency)) : "")))
        : h("p", { class: "bv-muted" }, "Pick a time below."));
    // date + slots
    const dateInput = h("input", { type: "date", value: state.date, min: new Date().toISOString().slice(0, 10), onChange: (e: Event) => { state.date = (e.target as HTMLInputElement).value; state.slot = null; loadSlots(); } });
    const slotsHost = h("div", null, h("div", { class: "bv-skeleton", style: { width: "60%" } }));
    const timeCard = h("div", { class: "pub-card" }, h("label", { class: "bv-label" }, "Pick a day"), dateInput, h("div", { style: { height: "12px" } }), h("label", { class: "bv-label" }, "Pick a time"), slotsHost);
    wrap.append(svcCard, timeCard);

    async function loadSlots() {
      slotsHost.innerHTML = ""; slotsHost.append(h("div", { class: "bv-skeleton", style: { width: "70%" } }));
      const { slots } = await fetch(`/api/public/${mid}/slots?v=${vKey}&service_id=${state.service?.id || ""}&date=${state.date}`).then((r) => r.json());
      slotsHost.innerHTML = "";
      if (!slots.length) { slotsHost.append(h("p", { class: "bv-muted" }, "No times available that day. Try another date.")); return; }
      slotsHost.append(h("div", { class: "bv-slots" }, ...slots.map((iso: string) => h("button", {
        class: "bv-slot" + (state.slot === iso ? " is-selected" : ""), type: "button",
        onClick: () => { state.slot = iso; render(); },
      }, new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })))));
    }
    loadSlots();

    // confirm
    if (state.slot) {
      const form = h("form", { class: "bv-stack", onSubmit: async (e: Event) => {
        e.preventDefault();
        const f = e.target as HTMLFormElement;
        const data: any = { vertical: vKey, service_id: state.service?.id || null, starts_at: state.slot, customer: (f.elements.namedItem("customer") as HTMLInputElement).value, contact: (f.elements.namedItem("contact") as HTMLInputElement).value };
        if (vc.detail) data.detail = (f.elements.namedItem("detail") as HTMLInputElement)?.value || null;
        const btn = f.querySelector("button") as HTMLButtonElement; btn.disabled = true; btn.textContent = "Booking…";
        try {
          const r = await fetch(`/api/public/${mid}/book`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((x) => x.json());
          if (r.ok) confirmScreen(data.customer, state.slot!, state.service?.name);
          else { flash(r.message || "That time was taken", "error"); btn.disabled = false; btn.textContent = "Confirm booking"; state.slot = null; render(); }
        } catch { btn.disabled = false; btn.textContent = "Confirm booking"; }
      } },
        h("p", { style: { margin: 0, fontWeight: "600" } }, `${state.service ? state.service.name + " · " : ""}${new Date(state.slot).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}`),
        h("input", { name: "customer", placeholder: "Your name", required: true }),
        h("input", { name: "contact", placeholder: "Phone or email" }),
        vc.detail ? h("input", { name: "detail", placeholder: vc.detail }) : null,
        h("button", { class: "primary", type: "submit" }, "Confirm booking"));
      wrap.append(h("div", { class: "pub-card" }, form));
    }
  }
  render();

  function confirmScreen(name: string, iso: string, service?: string | null) {
    wrap.innerHTML = "";
    wrap.append(h("div", { class: "pub-card", style: { textAlign: "center" } },
      h("div", { class: "bv-empty", style: { padding: "16px 0" } },
        h("div", { class: "ic", style: { background: "var(--ok-wash)", color: "var(--ok)" }, html: icon("check", 26) }),
        h("h3", null, "You're booked!"),
        h("p", null, `${name}, your ${service ? service + " " : ""}appointment is confirmed for ${new Date(iso).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}.`)),
      h("p", { class: "bv-muted" }, `${m.name} will see you then.`)));
  }
}
