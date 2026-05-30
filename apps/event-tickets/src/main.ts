import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

interface Ev { id: number; name: string; event_date: string | null; venue: string | null; price: number; currency: string; capacity: number; sold: number; checked_in: number; }
interface Ticket { id: number; code: string; buyer_name: string | null; checked_in: number; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";

(async () => {
  let session;
  try { session = await initBv(); }
  catch (err: any) { root.innerHTML = fatal("Event Tickets", err?.message); return; }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  renderShell();
  await refresh();
})();

function renderShell() {
  root.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div><h1>Event Tickets</h1><p class="bv-muted">${esc(merchantName)} · sell tickets, scan at the door</p></div>
        <span class="bv-pill">by Bookerva</span>
      </header>
      <div id="stats" class="bv-grid bv-grid-3" style="margin-bottom:16px;">${statSkel(3)}</div>
      <div class="bv-grid bv-grid-2" style="margin-bottom:16px;">
        <div class="bv-card">
          <h2 style="margin-top:0;">New event</h2>
          <form id="ev-form" class="bv-stack">
            <div><label class="bv-label">Name</label><input id="f-name" placeholder="Reggae Night" /></div>
            <div class="bv-grid bv-grid-2">
              <div><label class="bv-label">Date</label><input id="f-date" type="date" /></div>
              <div><label class="bv-label">Capacity (0 = unlimited)</label><input id="f-cap" type="number" placeholder="0" /></div>
            </div>
            <div class="bv-grid bv-grid-2">
              <div><label class="bv-label">Venue</label><input id="f-venue" placeholder="Optional" /></div>
              <div><label class="bv-label">Price</label><input id="f-price" type="number" step="0.01" placeholder="0.00" /></div>
            </div>
            <div class="bv-row"><button type="submit" class="primary">Create event</button></div>
          </form>
        </div>
        <div class="bv-card">
          <h2 style="margin-top:0;">Door check-in</h2>
          <p class="bv-muted" style="margin-top:0;">Type or scan a ticket code to validate entry.</p>
          <form id="ci-form" class="bv-row">
            <input id="ci-code" placeholder="TK-XXXXXXXX" style="flex:1;" autocomplete="off" />
            <button type="submit" class="primary">Check in</button>
          </form>
          <div id="ci-result" style="margin-top:10px;"></div>
        </div>
      </div>
      <h2 class="bv-section-title">Events</h2>
      <div id="list" class="bv-card"><div class="bv-skeleton" style="width:70%;"></div></div>
      <div id="tickets-panel"></div>
    </div>`;
  document.getElementById("ev-form")!.addEventListener("submit", onCreate);
  document.getElementById("ci-form")!.addEventListener("submit", onCheckin);
}

async function refresh() {
  try {
    const { events, stats } = await bvApi<{ events: Ev[]; stats: any }>("/api/events");
    document.getElementById("stats")!.innerHTML =
      statCard("Events", String(stats.events)) + statCard("Tickets sold", String(stats.tickets)) + statCard("Checked in", String(stats.checked_in));
    const el = document.getElementById("list")!;
    if (!events.length) { el.innerHTML = `<div class="bv-empty">No events yet. Create one above.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>Event</th><th>When</th><th>Price</th><th>Sold</th><th></th></tr></thead>
      <tbody>${events.map((e) => `<tr>
        <td><strong>${esc(e.name)}</strong>${e.venue ? `<div class="bv-muted">${esc(e.venue)}</div>` : ""}</td>
        <td class="bv-muted">${esc(e.event_date || "—")}</td>
        <td>${e.price ? money(e.price, e.currency) : "Free"}</td>
        <td>${e.sold}${e.capacity ? ` / ${e.capacity}` : ""} <span class="bv-muted">(${e.checked_in} in)</span></td>
        <td style="text-align:right;white-space:nowrap;">
          <button data-act="tickets" data-id="${e.id}">Tickets</button>
          <button data-act="del" data-id="${e.id}" class="destructive">Delete</button>
        </td></tr>`).join("")}</tbody></table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", () => onEvAction(b)));
  } catch (err: any) {
    document.getElementById("list")!.innerHTML = `<div class="bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`;
  }
}

async function onCreate(e: Event) {
  e.preventDefault();
  const body = {
    name: (document.getElementById("f-name") as HTMLInputElement).value,
    event_date: (document.getElementById("f-date") as HTMLInputElement).value || null,
    venue: (document.getElementById("f-venue") as HTMLInputElement).value || null,
    price: (document.getElementById("f-price") as HTMLInputElement).value || 0,
    capacity: (document.getElementById("f-cap") as HTMLInputElement).value || 0,
  };
  try { await bvApi("/api/events", { method: "POST", body: JSON.stringify(body) });
    toast("Event created", "success"); (document.getElementById("ev-form") as HTMLFormElement).reset(); await refresh(); }
  catch (err: any) { toast(err?.message || "Couldn't create", "error"); }
}

async function onCheckin(e: Event) {
  e.preventDefault();
  const code = (document.getElementById("ci-code") as HTMLInputElement).value;
  const out = document.getElementById("ci-result")!;
  try {
    const r = await bvApi<any>("/api/checkin", { method: "POST", body: JSON.stringify({ code }) });
    if (r.ok) out.innerHTML = `<div class="bv-pill" data-tone="success">✓ Valid — ${esc(r.buyer || "Guest")} · ${esc(r.event)}</div>`;
    else if (r.reason === "already_used") out.innerHTML = `<div class="bv-pill" data-tone="warning">Already checked in — ${esc(r.buyer || "Guest")}</div>`;
    else out.innerHTML = `<div class="bv-pill" data-tone="destructive">Invalid ticket</div>`;
    (document.getElementById("ci-code") as HTMLInputElement).value = "";
    await refresh();
  } catch (err: any) { toast(err?.message || "Check-in failed", "error"); }
}

async function onEvAction(btn: HTMLButtonElement) {
  const id = Number(btn.dataset.id);
  if (btn.dataset.act === "del") {
    try { await bvApi(`/api/events/${id}`, { method: "DELETE" }); toast("Deleted", "success"); document.getElementById("tickets-panel")!.innerHTML = ""; await refresh(); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  } else await renderTickets(id);
}

async function renderTickets(id: number) {
  const panel = document.getElementById("tickets-panel")!;
  panel.innerHTML = `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div></div>`;
  try {
    const { event, tickets } = await bvApi<{ event: Ev; tickets: Ticket[] }>(`/api/events/${id}/tickets`);
    panel.innerHTML = `<div class="bv-card">
      <h2 style="margin-top:0;">${esc(event.name)} — tickets</h2>
      <form id="issue-form" class="bv-row" style="margin-bottom:12px;">
        <input id="t-buyer" placeholder="Buyer name (optional)" style="flex:1;" />
        <button type="submit" class="primary">Issue ticket</button>
      </form>
      ${tickets.length ? `<table class="bv-table"><thead><tr><th>Code</th><th>Buyer</th><th>Status</th></tr></thead>
        <tbody>${tickets.map((t) => `<tr><td><span class="bv-mono">${esc(t.code)}</span></td>
          <td>${esc(t.buyer_name || "—")}</td>
          <td>${t.checked_in ? `<span class="bv-pill" data-tone="success">Checked in</span>` : `<span class="bv-pill">Issued</span>`}</td></tr>`).join("")}</tbody></table>`
        : `<div class="bv-empty">No tickets issued yet.</div>`}</div>`;
    document.getElementById("issue-form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const buyer = (document.getElementById("t-buyer") as HTMLInputElement).value;
      try { const r = await bvApi<any>(`/api/events/${id}/tickets`, { method: "POST", body: JSON.stringify({ buyer_name: buyer }) });
        toast(`Ticket ${r.code} issued`, "success"); await renderTickets(id); await refresh(); }
      catch (err: any) { toast(err?.message || "Couldn't issue", "error"); }
    });
  } catch (err: any) { panel.innerHTML = `<div class="bv-card bv-empty">Couldn't load tickets: ${esc(err?.message || "error")}</div>`; }
}

function statCard(l: string, v: string) { return `<div class="bv-card"><div class="bv-label">${esc(l)}</div><div style="font-size:24px;font-weight:600;">${esc(v)}</div></div>`; }
function statSkel(n: number) { return Array.from({ length: n }).map(() => `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div><div class="bv-skeleton" style="height:24px;width:40%;margin-top:6px;"></div></div>`).join(""); }
function money(n: number, c: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n); } catch { return `${n.toFixed(2)} ${c}`; } }
function fatal(t: string, m?: string) { return `<div class="bv-shell"><div class="bv-card" style="text-align:center;"><h1>${esc(t)} couldn't load</h1><p class="bv-muted">${esc(m || "Unknown error")}</p></div></div>`; }
function esc(s: string) { return String(s).replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"); }
