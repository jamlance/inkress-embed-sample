import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, statRow, dataTable, card, openModal, flash,
  fmtMoney, relTime, pill, emptyState, h, iconEl,
} from "./bv-init";

interface Design { id: number; name: string; denominations: number[]; allow_custom: boolean; min_amount: number; max_amount: number; currency: string; active: boolean; public_url: string; }
interface Card { id: number; code: string; amount: number; balance: number; currency: string; recipient_name: string | null; recipient_email: string | null; state: string; created_at: string; }
interface Redemption { id: number; code: string; amount: number; note: string | null; created_by_name: string | null; created_at: string; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let currency = "JMD";
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
    brandIcon: "gift",
    title: "Gift Cards",
    subtitle: `${merchantName} · sell gift cards, redeem in store`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "cards", label: "Cards", icon: "gift", render: renderCards },
      { id: "designs", label: "Buy pages", icon: "tag", render: renderDesigns },
      { id: "redemptions", label: "Redemptions", icon: "list", render: renderRedemptions },
    ],
  });
})();

/* -------------------------------------------------------------------- Cards */
async function renderCards(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { cards: Card[]; stats: { sold: number; outstanding: number; redeemed_value: number; awaiting: number } };
  try { data = await bvApi("/api/cards?refresh=1"); }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";

  host.append(statRow([
    { k: "Cards sold", v: String(data.stats.sold), tone: "ok", icon: "gift" },
    { k: "Outstanding balance", v: fmtMoney(data.stats.outstanding, currency), tone: "accent", icon: "wallet" },
    { k: "Redeemed value", v: fmtMoney(data.stats.redeemed_value, currency), icon: "coins" },
    { k: "Awaiting payment", v: String(data.stats.awaiting), icon: "clock" },
  ]));

  const redeem = h("button", { class: "primary", onClick: () => openRedeem() }, iconEl("check", 15), "Redeem a card");
  host.append(card({ title: "Issued cards", action: redeem, body: data.cards.length ? dataTable<Card>({
    columns: [
      { head: "Code", cell: (c) => h("strong", { class: "gc-code" }, c.code) },
      { head: "Value", num: true, cell: (c) => fmtMoney(c.amount, c.currency) },
      { head: "Balance", num: true, cell: (c) => h("b", { class: c.balance > 0 ? "" : "bv-muted" }, fmtMoney(c.balance, c.currency)) },
      { head: "Recipient", cell: (c) => h("span", { class: "bv-muted" }, c.recipient_email || "—") },
      { head: "State", cell: (c) => pill(c.state, c.state === "active" ? "ok" : c.state === "redeemed" ? undefined : c.state === "awaiting" ? "warn" : "bad") },
    ],
    rows: data.cards,
    rowActions: (c) => (c.state === "active" && c.balance > 0) ? h("button", { class: "ghost sm", onClick: () => openRedeem(c.code) }, "Redeem") : null,
  }) : emptyState({ icon: "gift", title: "No gift cards yet", text: "Create a buy page and share it — purchases show up here." }) }));
}

function openRedeem(prefill?: string) {
  const codeInput = h("input", { value: prefill || "", placeholder: "GC-XXXX-XXXX", style: { textTransform: "uppercase" } }) as HTMLInputElement;
  const result = h("div", { class: "gc-redeem-result" });
  let card_: Card | null = null;
  const lookup = async () => {
    result.innerHTML = "";
    try {
      const r = await bvApi<{ found: boolean; card?: Card }>("/api/cards/lookup", { method: "POST", body: JSON.stringify({ code: codeInput.value }) });
      if (!r.found || !r.card) { result.append(h("div", { class: "gc-bad" }, "No card with that code.")); card_ = null; return; }
      card_ = r.card;
      if (card_.state === "awaiting") { result.append(h("div", { class: "gc-bad" }, "Not paid for yet.")); return; }
      const amt = h("input", { type: "number", min: "0", step: "0.01", max: String(card_.balance), placeholder: `Up to ${card_.balance}`, value: String(card_.balance) }) as HTMLInputElement;
      result.append(
        h("div", { class: "gc-balance" }, h("span", { class: "bv-muted" }, "Balance"), h("b", null, fmtMoney(card_.balance, card_.currency))),
        h("label", { class: "gc-field" }, h("span", { class: "bv-label" }, "Redeem amount"), amt),
        h("button", { class: "primary", onClick: async () => {
          try { await bvApi(`/api/cards/${card_!.id}/redeem`, { method: "POST", body: JSON.stringify({ amount: Number(amt.value) }) }); flash("Redeemed", "success"); shell.select("cards"); document.querySelector(".bv-scrim")?.remove(); }
          catch (err: any) { toast(err?.message || "error", "error"); }
        } }, "Redeem"));
    } catch (err: any) { result.append(h("div", { class: "gc-bad" }, err?.message || "error")); }
  };
  const body = h("div", null, h("label", { class: "gc-field" }, h("span", { class: "bv-label" }, "Gift card code"), codeInput), h("button", { class: "ghost", style: { marginTop: "8px" }, onClick: () => { void lookup(); } }, "Look up"), result);
  openModal({ title: "Redeem a gift card", body, actions: [{ label: "Close", onClick: () => {} }] });
  if (prefill) void lookup();
}

/* ------------------------------------------------------------------ Designs */
async function renderDesigns(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { designs: Design[]; connected: boolean };
  try { data = await bvApi("/api/designs"); }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";
  const add = h("button", { class: "primary", onClick: () => openDesign(null) }, iconEl("plus", 15), "New buy page");
  if (!data.designs.length) { host.append(card({ title: "Buy pages", action: add, body: emptyState({ icon: "tag", title: "No buy pages yet", text: "Create one and share its link — customers buy gift cards from it." }) })); return; }

  const grid = h("div", { class: "gc-grid" });
  for (const d of data.designs) {
    grid.append(h("div", { class: "gc-card" },
      h("div", { class: "gc-card-head" }, h("strong", null, d.name), d.active ? pill("live", "ok") : pill("off")),
      h("div", { class: "gc-denoms" }, ...(d.denominations.length ? d.denominations.map((a) => pill(fmtMoney(a, d.currency))) : [h("span", { class: "bv-muted" }, "custom amount")])),
      h("div", { class: "gc-link" }, h("input", { class: "gc-link-input", readonly: true, value: d.public_url }), h("button", { class: "ghost sm", onClick: () => { navigator.clipboard?.writeText(d.public_url); flash("Link copied", "success"); } }, iconEl("copy", 14))),
      h("div", { class: "gc-actions" }, h("a", { class: "gc-open", href: d.public_url, target: "_blank", rel: "noopener" }, iconEl("external", 14)), h("button", { class: "ghost sm", onClick: () => openDesign(d) }, iconEl("edit", 14)), h("button", { class: "ghost sm", onClick: async () => { await bvApi(`/api/designs/${d.id}`, { method: "DELETE" }); shell.select("designs"); } }, iconEl("trash", 14)))));
  }
  host.append(card({ title: "Buy pages", action: add, body: grid }));
  if (!data.connected) host.append(h("div", { class: "gc-note bv-muted" }, iconEl("alert", 14), "Connecting to your Inkress account — public purchases activate momentarily."));
}

function openDesign(d: Design | null) {
  const name = h("input", { value: d?.name || "Gift Card", placeholder: "Gift card name" }) as HTMLInputElement;
  const denoms = h("input", { value: (d?.denominations || [1000, 2500, 5000]).join(", "), placeholder: "1000, 2500, 5000" }) as HTMLInputElement;
  const min = h("input", { type: "number", value: String(d?.min_amount ?? 500) }) as HTMLInputElement;
  const max = h("input", { type: "number", value: String(d?.max_amount ?? 50000) }) as HTMLInputElement;
  const custom = h("input", { type: "checkbox", checked: d ? d.allow_custom : true }) as HTMLInputElement;
  const active = h("input", { type: "checkbox", checked: d ? d.active : true }) as HTMLInputElement;
  const body = h("div", { class: "gc-form" },
    field("Name", name), field("Preset amounts (comma-separated)", denoms),
    h("div", { class: "gc-form-grid" }, field("Min custom", min), field("Max custom", max)),
    h("label", { class: "gc-check" }, custom, " Allow custom amount"),
    d ? h("label", { class: "gc-check" }, active, " Active") : null);
  const save = async () => {
    const denominations = denoms.value.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
    const payload: any = { name: name.value, denominations, allow_custom: custom.checked, min_amount: Number(min.value), max_amount: Number(max.value) };
    try {
      if (d) { payload.active = active.checked; await bvApi(`/api/designs/${d.id}`, { method: "PATCH", body: JSON.stringify(payload) }); }
      else await bvApi("/api/designs", { method: "POST", body: JSON.stringify(payload) });
      flash(d ? "Saved" : "Buy page created", "success"); shell.select("designs");
    } catch (err: any) { toast(err?.message || "error", "error"); }
  };
  openModal({ title: d ? "Edit buy page" : "New buy page", body, actions: [{ label: d ? "Save" : "Create", primary: true, onClick: () => { void save(); } }] });
}

/* -------------------------------------------------------------- Redemptions */
async function renderRedemptions(host: HTMLElement) {
  let log: Redemption[];
  try { log = (await bvApi<{ redemptions: Redemption[] }>("/api/redemptions")).redemptions; }
  catch (err: any) { host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.append(card({ title: "Redemptions", body: log.length ? dataTable<Redemption>({
    columns: [
      { head: "When", cell: (r) => h("span", { class: "bv-muted" }, relTime(r.created_at)) },
      { head: "Code", cell: (r) => h("strong", { class: "gc-code" }, r.code) },
      { head: "Amount", num: true, cell: (r) => fmtMoney(r.amount, currency) },
      { head: "By", cell: (r) => h("span", { class: "bv-muted" }, r.created_by_name || "—") },
    ], rows: log,
  }) : emptyState({ icon: "list", title: "No redemptions yet", text: "Redeem a card from the Cards tab." }) }));
}

function field(label: string, el: HTMLElement) { return h("label", { class: "gc-field" }, h("span", { class: "bv-label" }, label), el); }
function fatal(msg?: string) { return h("div", { class: "bv-empty", style: { margin: "40px auto" } }, h("h3", null, "Gift Cards couldn't load"), h("p", null, msg || "Open this app from the Inkress dashboard.")); }
