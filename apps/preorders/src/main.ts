import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, statRow, dataTable, card, openModal, flash,
  fmtMoney, fmtDate, relTime, pill, emptyState, h, iconEl,
} from "./bv-init";

interface Campaign { id: number; title: string; blurb: string | null; image_url: string | null; deposit: number; full_price: number | null; target_qty: number | null; available_on: string | null; currency: string; active: boolean; reserved: number; awaiting: number; public_url: string; }
interface Reservation { id: number; customer_name: string | null; customer_email: string | null; deposit: number; currency: string; state: string; payment_url: string | null; created_at: string; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let currency = "JMD";
let campaigns: Campaign[] = [];
let resCampaign = 0;
let shell: ReturnType<typeof mountShell>;

(async () => {
  let session;
  if (import.meta.env.DEV && !new URLSearchParams(location.search).has("inkress_session")) {
    const m = await import("./dev-mock"); m.installMockFetch(); session = m.mockSession();
  } else {
    try { session = await initBv(); }
    catch (err: any) { root.innerHTML = ""; root.append(fatal(err?.message)); return; }
  }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  currency = session.merchant.currency_code || "JMD";

  shell = mountShell({
    brandIcon: "box",
    title: "Pre-orders",
    subtitle: `${merchantName} · sell it before it's in stock`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "campaigns", label: "Campaigns", icon: "box", render: renderCampaigns },
      { id: "reservations", label: "Reservations", icon: "list", render: renderReservations },
    ],
  });
})();

/* ----------------------------------------------------------------- Campaigns */
async function renderCampaigns(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { campaigns: Campaign[]; connected: boolean };
  try { data = await bvApi("/api/campaigns"); campaigns = data.campaigns; }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";

  host.append(statRow([
    { k: "Campaigns", v: String(campaigns.length), icon: "box" },
    { k: "Reserved (paid)", v: String(campaigns.reduce((s, c) => s + c.reserved, 0)), tone: "ok", icon: "check" },
    { k: "Awaiting deposit", v: String(campaigns.reduce((s, c) => s + c.awaiting, 0)), tone: "accent", icon: "clock" },
  ]));

  const add = h("button", { class: "primary", onClick: () => openCampaign(null) }, iconEl("plus", 15), "New pre-order");
  if (!campaigns.length) { host.append(card({ title: "Pre-orders", action: add, body: emptyState({ icon: "box", title: "No pre-orders yet", text: "Create one, then share its public link — customers reserve with a deposit." }) })); return; }

  const grid = h("div", { class: "po-grid" });
  for (const c of campaigns) {
    const target = c.target_qty || 0;
    const pct = target ? Math.min(100, Math.round((c.reserved / target) * 100)) : 0;
    grid.append(h("div", { class: "po-card" + (c.active ? "" : " is-off") },
      c.image_url ? h("img", { class: "po-img", src: c.image_url, alt: "" }) : h("div", { class: "po-img po-img-ph" }, iconEl("box", 28)),
      h("div", { class: "po-body" },
        h("div", { class: "po-head" }, h("strong", null, c.title), c.active ? null : pill("paused")),
        h("div", { class: "po-deposit" }, fmtMoney(c.deposit, c.currency), h("span", { class: "bv-muted" }, " deposit")),
        target ? h("div", null, h("div", { class: "po-prog" }, h("i", { style: { width: `${pct}%` } })), h("div", { class: "bv-muted po-progt" }, `${c.reserved} of ${target} reserved`)) : h("div", { class: "bv-muted po-progt" }, `${c.reserved} reserved`),
        h("div", { class: "po-link" }, h("input", { class: "po-link-input", readonly: true, value: c.public_url }), h("button", { class: "ghost sm", title: "Copy link", onClick: () => { navigator.clipboard?.writeText(c.public_url); flash("Public link copied", "success"); } }, iconEl("copy", 14))),
        h("div", { class: "po-actions" },
          h("button", { class: "ghost sm", onClick: () => { resCampaign = c.id; shell.select("reservations"); } }, `${c.reserved + c.awaiting} reservation${c.reserved + c.awaiting === 1 ? "" : "s"}`),
          h("a", { class: "po-open", href: c.public_url, target: "_blank", rel: "noopener" }, iconEl("external", 14)),
          h("button", { class: "ghost sm", onClick: () => openCampaign(c) }, iconEl("edit", 14)),
          h("button", { class: "ghost sm", onClick: async () => { await bvApi(`/api/campaigns/${c.id}`, { method: "DELETE" }); shell.select("campaigns"); } }, iconEl("trash", 14))))));
  }
  host.append(card({ title: "Pre-orders", action: add, body: grid }));
  if (!data.connected) host.append(h("div", { class: "po-note bv-muted" }, iconEl("alert", 14), "Finishing connection to your Inkress account — public reservations activate momentarily."));
}

function openCampaign(c: Campaign | null) {
  const title = h("input", { value: c?.title || "", placeholder: "e.g. Limited Edition Hoodie" }) as HTMLInputElement;
  const blurb = h("input", { value: c?.blurb || "", placeholder: "Short description (optional)" }) as HTMLInputElement;
  const deposit = h("input", { type: "number", min: "0", step: "0.01", value: c ? String(c.deposit) : "", placeholder: "0.00" }) as HTMLInputElement;
  const full = h("input", { type: "number", min: "0", step: "0.01", value: c?.full_price != null ? String(c.full_price) : "", placeholder: "optional" }) as HTMLInputElement;
  const target = h("input", { type: "number", min: "1", value: c?.target_qty != null ? String(c.target_qty) : "", placeholder: "optional" }) as HTMLInputElement;
  const avail = h("input", { type: "date", value: c?.available_on?.slice(0, 10) || "" }) as HTMLInputElement;
  const image = h("input", { value: c?.image_url || "", placeholder: "Image URL (optional)" }) as HTMLInputElement;
  const active = h("input", { type: "checkbox", checked: c ? c.active : true }) as HTMLInputElement;

  const body = h("div", { class: "po-form" },
    field("Title", title), field("Description", blurb),
    h("div", { class: "po-form-grid" }, field("Deposit", deposit), field("Full price", full), field("Target qty", target), field("Available on", avail)),
    field("Image URL", image),
    c ? h("label", { class: "po-check" }, active, " Active (accepting reservations)") : null);

  const save = async () => {
    if (!title.value.trim() || !(Number(deposit.value) > 0)) { toast("Title and deposit are required", "warning"); return; }
    const payload: any = { title: title.value, blurb: blurb.value, image_url: image.value || null, deposit: Number(deposit.value), full_price: full.value || null, target_qty: target.value || null, available_on: avail.value || null };
    try {
      if (c) { payload.active = active.checked; await bvApi(`/api/campaigns/${c.id}`, { method: "PATCH", body: JSON.stringify(payload) }); }
      else await bvApi("/api/campaigns", { method: "POST", body: JSON.stringify(payload) });
      flash(c ? "Saved" : "Pre-order created", "success"); shell.select("campaigns");
    } catch (err: any) { toast(err?.message || "error", "error"); }
  };
  openModal({ title: c ? "Edit pre-order" : "New pre-order", body, actions: [{ label: c ? "Save" : "Create", primary: true, onClick: () => { void save(); } }] });
}

/* -------------------------------------------------------------- Reservations */
async function renderReservations(host: HTMLElement) {
  if (!campaigns.length) { try { campaigns = (await bvApi<{ campaigns: Campaign[] }>("/api/campaigns")).campaigns; } catch { /* */ } }
  if (!campaigns.length) { host.append(emptyState({ icon: "list", title: "No campaigns", text: "Create a pre-order first." })); return; }
  if (!resCampaign || !campaigns.find((c) => c.id === resCampaign)) resCampaign = campaigns[0]!.id;

  const picker = h("select", { onChange: (e: any) => { resCampaign = Number(e.target.value); shell.select("reservations"); } },
    ...campaigns.map((c) => h("option", { value: String(c.id), selected: c.id === resCampaign }, c.title))) as HTMLSelectElement;

  const body = h("div");
  host.append(card({ title: "Reservations", action: picker, body }));
  body.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let rows: Reservation[];
  try { rows = (await bvApi<{ reservations: Reservation[] }>(`/api/campaigns/${resCampaign}/reservations?refresh=1`)).reservations; }
  catch (err: any) { body.innerHTML = ""; body.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  body.innerHTML = "";
  body.append(rows.length ? dataTable<Reservation>({
    columns: [
      { head: "Customer", cell: (r) => h("div", null, h("strong", null, r.customer_name || "—"), r.customer_email ? h("div", { class: "bv-muted" }, r.customer_email) : null) },
      { head: "Deposit", num: true, cell: (r) => fmtMoney(r.deposit, r.currency) },
      { head: "State", cell: (r) => pill(r.state, r.state === "paid" ? "ok" : "warn") },
      { head: "When", cell: (r) => h("span", { class: "bv-muted" }, relTime(r.created_at)) },
    ], rows,
  }) : emptyState({ icon: "inbox", title: "No reservations yet", text: "Share the public link to start taking deposits." }));
}

/* -------------------------------------------------------------------- helpers */
function field(label: string, el: HTMLElement) { return h("label", { class: "po-field" }, h("span", { class: "bv-label" }, label), el); }
function fatal(msg?: string) { return h("div", { class: "bv-empty", style: { margin: "40px auto" } }, h("h3", null, "Pre-orders couldn't load"), h("p", null, msg || "Open this app from the Inkress dashboard.")); }
