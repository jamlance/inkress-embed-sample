import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, statRow, dataTable, card, openModal, flash,
  fmtMoney, fmtDate, relTime, pill, emptyState, h, iconEl,
} from "./bv-init";

interface Code { id: number; code: string; kind: "percent" | "fixed"; value: number; min_spend: number; max_uses: number | null; used_count: number; expires_on: string | null; active: boolean; currency: string; }
interface Redemption { id: number; code: string; original: number; discount: number; net: number; currency: string; customer: string | null; payment_url: string | null; inkress_order_id: string | null; state: string; created_at: string; }

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
    brandIcon: "tag",
    title: "Promo Codes",
    subtitle: `${merchantName} · discounts that create real pay links`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "codes", label: "Codes", icon: "tag", render: renderCodes },
      { id: "charge", label: "Charge with code", icon: "credit-card", render: renderCharge },
      { id: "redemptions", label: "Redemptions", icon: "list", render: renderRedemptions },
    ],
  });
})();

/* --------------------------------------------------------------------- Codes */
async function renderCodes(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { codes: Code[]; stats: { active: number; redemptions: number; discount_given: number } };
  try { data = await bvApi("/api/codes"); }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";

  host.append(statRow([
    { k: "Active codes", v: String(data.stats.active), tone: "accent", icon: "tag" },
    { k: "Redemptions", v: String(data.stats.redemptions), icon: "list" },
    { k: "Discount given", v: fmtMoney(data.stats.discount_given, currency), tone: "ok", icon: "coins" },
  ]));

  const add = h("button", { class: "primary", onClick: () => openCode(null) }, iconEl("plus", 15), "New code");
  host.append(card({
    title: "Codes", action: add,
    body: data.codes.length ? dataTable<Code>({
      columns: [
        { head: "Code", cell: (c) => h("strong", { class: "pc-code" }, c.code) },
        { head: "Discount", cell: (c) => c.kind === "percent" ? `${c.value}% off` : `${fmtMoney(c.value, c.currency)} off` },
        { head: "Min spend", num: true, cell: (c) => c.min_spend ? fmtMoney(c.min_spend, c.currency) : "—" },
        { head: "Used", num: true, cell: (c) => `${c.used_count}${c.max_uses != null ? ` / ${c.max_uses}` : ""}` },
        { head: "Expires", cell: (c) => c.expires_on ? fmtDate(c.expires_on) : "—" },
        { head: "Status", cell: (c) => c.active ? pill("active", "ok") : pill("off") },
      ],
      rows: data.codes,
      onRowClick: (c) => openCode(c),
    }) : emptyState({ icon: "tag", title: "No promo codes yet", text: "Create a code, then apply it on the Charge tab." }),
  }));
}

function openCode(c: Code | null) {
  const code = h("input", { value: c?.code || "", placeholder: "e.g. WELCOME10", disabled: !!c, style: { textTransform: "uppercase" } }) as HTMLInputElement;
  const kind = h("select", null, h("option", { value: "percent", selected: c?.kind !== "fixed" }, "% off"), h("option", { value: "fixed", selected: c?.kind === "fixed" }, "Fixed amount off")) as HTMLSelectElement;
  const value = h("input", { type: "number", min: "0", step: "0.01", value: c ? String(c.value) : "", placeholder: "10" }) as HTMLInputElement;
  const minSpend = h("input", { type: "number", min: "0", value: c ? String(c.min_spend) : "", placeholder: "0" }) as HTMLInputElement;
  const maxUses = h("input", { type: "number", min: "1", value: c?.max_uses != null ? String(c.max_uses) : "", placeholder: "unlimited" }) as HTMLInputElement;
  const expires = h("input", { type: "date", value: c?.expires_on?.slice(0, 10) || "" }) as HTMLInputElement;
  const active = h("input", { type: "checkbox", checked: c ? c.active : true }) as HTMLInputElement;

  const body = h("div", { class: "pc-form" },
    h("div", { class: "pc-form-grid" }, field("Code", code), field("Discount type", kind), field("Value", value), field("Min spend", minSpend), field("Max uses", maxUses), field("Expires", expires)),
    c ? h("label", { class: "pc-check" }, active, " Active") : null);

  const save = async () => {
    if (!c && !code.value.trim()) { toast("Enter a code", "warning"); return; }
    if (!(Number(value.value) > 0)) { toast("Enter a discount value", "warning"); return; }
    const payload: any = { value: Number(value.value), min_spend: Number(minSpend.value) || 0, max_uses: maxUses.value || null, expires_on: expires.value || null };
    try {
      if (c) { payload.active = active.checked; await bvApi(`/api/codes/${c.id}`, { method: "PATCH", body: JSON.stringify(payload) }); }
      else { payload.code = code.value; payload.kind = kind.value; await bvApi("/api/codes", { method: "POST", body: JSON.stringify(payload) }); }
      flash(c ? "Code updated" : "Code created", "success"); shell.select("codes");
    } catch (err: any) { toast(err?.message || "error", "error"); }
  };
  const actions: any[] = [{ label: c ? "Save" : "Create", primary: true, onClick: () => { void save(); } }];
  if (c) actions.unshift({ label: "Delete", danger: true, onClick: () => { void (async () => { try { await bvApi(`/api/codes/${c.id}`, { method: "DELETE" }); flash("Deleted", "info"); shell.select("codes"); } catch (e: any) { toast(e?.message || "error", "error"); } })(); } });
  openModal({ title: c ? `Edit ${c.code}` : "New promo code", body, actions });
}

/* -------------------------------------------------------------------- Charge */
function renderCharge(host: HTMLElement) {
  let preview: { valid: boolean; discount?: number; net?: number; reason?: string } | null = null;
  const amount = h("input", { type: "number", min: "0", step: "0.01", placeholder: "0.00", class: "pc-field-input" }) as HTMLInputElement;
  const codeInput = h("input", { placeholder: "Code", class: "pc-field-input", style: { textTransform: "uppercase" } }) as HTMLInputElement;
  const cName = h("input", { placeholder: "Customer name", class: "pc-field-input" }) as HTMLInputElement;
  const cEmail = h("input", { type: "email", placeholder: "Email (optional)", class: "pc-field-input" }) as HTMLInputElement;
  const previewBox = h("div", { class: "pc-preview" });
  const result = h("div");

  let t: any;
  const doValidate = async () => {
    const amt = Number(amount.value); const code = codeInput.value.trim();
    if (!amt || !code) { preview = null; renderPreview(); return; }
    try { preview = await bvApi("/api/validate", { method: "POST", body: JSON.stringify({ amount: amt, code }) }); }
    catch { preview = null; }
    renderPreview();
  };
  const renderPreview = () => {
    previewBox.innerHTML = "";
    if (!preview) return;
    if (!preview.valid) { previewBox.append(h("div", { class: "pc-preview-bad" }, iconEl("alert", 15), reasonText(preview.reason))); return; }
    previewBox.append(
      h("div", { class: "pc-preview-row" }, h("span", null, "Discount"), h("b", { class: "pc-disc" }, `− ${fmtMoney(preview.discount!, currency)}`)),
      h("div", { class: "pc-preview-row pc-preview-net" }, h("span", null, "Customer pays"), h("b", null, fmtMoney(preview.net!, currency))));
  };
  amount.addEventListener("input", () => { clearTimeout(t); t = setTimeout(doValidate, 250); });
  codeInput.addEventListener("input", () => { clearTimeout(t); t = setTimeout(doValidate, 250); });

  const charge = h("button", { class: "primary pc-charge", onClick: async () => {
    const amt = Number(amount.value);
    if (!(amt > 0)) { toast("Enter an amount", "warning"); return; }
    if (!codeInput.value.trim()) { toast("Enter a code", "warning"); return; }
    try {
      const r = await bvApi<{ payment_url: string; redemption: Redemption }>("/api/charge", { method: "POST", body: JSON.stringify({ amount: amt, code: codeInput.value, customer: { name: cName.value, email: cEmail.value || null } }) });
      showResult(r.redemption, r.payment_url);
    } catch (err: any) { toast(err?.message || "Couldn't create link", "error"); }
  } }, iconEl("send", 16), "Create discounted pay link");

  host.append(card({ title: "Charge with a code", body: h("div", { class: "pc-charge-form" },
    h("div", { class: "pc-form-grid" }, field("Amount before discount", amount), field("Promo code", codeInput), field("Customer name", cName), field("Email", cEmail)),
    previewBox, charge, result) }));

  function showResult(red: Redemption, url: string | null) {
    const body = h("div", null,
      h("div", { class: "pc-result-sum" },
        h("div", null, h("span", { class: "bv-muted" }, "Was "), h("s", null, fmtMoney(red.original, red.currency))),
        h("div", { class: "pc-result-net" }, fmtMoney(red.net, red.currency)),
        pill(`${red.code} · −${fmtMoney(red.discount, red.currency)}`, "primary")));
    if (url) body.append(h("div", { class: "pc-actions", style: { marginTop: "12px" } },
      h("button", { class: "primary", onClick: () => { navigator.clipboard?.writeText(url); flash("Link copied", "success"); } }, iconEl("copy", 15), "Copy pay link"),
      h("a", { class: "pc-btnlink", href: url, target: "_blank", rel: "noopener" }, iconEl("external", 15), "Open")));
    openModal({ title: "Discounted link ready", body, actions: [{ label: "Done", primary: true, onClick: () => { amount.value = ""; codeInput.value = ""; cName.value = ""; cEmail.value = ""; preview = null; renderPreview(); result.innerHTML = ""; shell.select("redemptions"); } }] });
  }
}

/* --------------------------------------------------------------- Redemptions */
async function renderRedemptions(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { redemptions: Redemption[] };
  try { data = await bvApi("/api/redemptions"); }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";
  host.append(card({ title: "Redemptions", body: data.redemptions.length ? dataTable<Redemption>({
    columns: [
      { head: "Code", cell: (r) => h("strong", { class: "pc-code" }, r.code) },
      { head: "Customer", cell: (r) => h("span", { class: "bv-muted" }, r.customer || "—") },
      { head: "Original", num: true, cell: (r) => h("s", { class: "bv-muted" }, fmtMoney(r.original, r.currency)) },
      { head: "Paid", num: true, cell: (r) => fmtMoney(r.net, r.currency) },
      { head: "State", cell: (r) => pill(r.state, r.state === "paid" ? "ok" : "warn") },
      { head: "When", cell: (r) => h("span", { class: "bv-muted" }, relTime(r.created_at)) },
    ],
    rows: data.redemptions,
    onRowClick: (r) => openRedemption(r),
  }) : emptyState({ icon: "list", title: "No redemptions yet", text: "Create a discounted link on the Charge tab." }) }));
}

function openRedemption(r: Redemption) {
  const body = h("div", null,
    h("div", { class: "pc-result-sum" }, h("div", null, h("s", { class: "bv-muted" }, fmtMoney(r.original, r.currency))), h("div", { class: "pc-result-net" }, fmtMoney(r.net, r.currency)), pill(`${r.code} · −${fmtMoney(r.discount, r.currency)}`, "primary")),
    h("div", { class: "pc-detail-meta" }, h("span", null, "State: ", pill(r.state, r.state === "paid" ? "ok" : "warn")), r.inkress_order_id ? h("span", { class: "bv-muted" }, `Inkress #${r.inkress_order_id}`) : null));
  if (r.payment_url) body.append(h("div", { class: "pc-actions", style: { marginTop: "10px" } }, h("button", { class: "ghost", onClick: () => { navigator.clipboard?.writeText(r.payment_url!); flash("Copied", "success"); } }, "Copy link"), h("a", { class: "pc-btnlink", href: r.payment_url, target: "_blank", rel: "noopener" }, "Open")));
  const actions: any[] = [{ label: "Close", onClick: () => {} }];
  if (r.state !== "paid") actions.unshift({ label: "Check payment", primary: true, onClick: () => { void (async () => { try { const x = await bvApi<{ changed: boolean }>(`/api/redemptions/${r.id}/poll`, { method: "POST" }); flash(x.changed ? "Paid!" : "Still awaiting", x.changed ? "success" : "info"); if (x.changed) shell.select("redemptions"); } catch (e: any) { toast(e?.message || "error", "error"); } })(); return true; } });
  openModal({ title: `Redemption · ${r.code}`, body, actions });
}

/* -------------------------------------------------------------------- helpers */
function reasonText(reason?: string) {
  return ({ not_found: "Code not found.", inactive: "Code is inactive.", expired: "Code has expired.", used_up: "Code has reached its usage limit.", min_spend: "Amount is below the minimum spend." } as Record<string, string>)[reason || ""] || "Code can't be applied.";
}
function field(label: string, el: HTMLElement) { return h("label", { class: "pc-field" }, h("span", { class: "bv-label" }, label), el); }
function fatal(msg?: string) {
  return h("div", { class: "bv-empty", style: { margin: "40px auto" } }, h("h3", null, "Promo Codes couldn't load"), h("p", null, msg || "Open this app from the Inkress dashboard."));
}
