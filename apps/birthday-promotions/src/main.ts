import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, statRow, dataTable, card, openModal, flash,
  fmtDate, relTime, pill, emptyState, h, iconEl,
} from "./bv-init";

interface Contact { id: number; name: string; email: string | null; birthday: string; last_sent_year: number | null; days_until: number; }
interface Settings { subject: string; body: string; code: string; days_before: number; }
interface LogRow { id: number; email: string; code: string; sent_by_name: string | null; created_at: string; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let sesOk = false;
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

  shell = mountShell({
    brandIcon: "cake",
    title: "Birthday Promotions",
    subtitle: `${merchantName} · celebrate customers, win loyalty`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "birthdays", label: "Birthdays", icon: "cake", render: renderBirthdays },
      { id: "message", label: "Message", icon: "message", render: renderMessage },
      { id: "sent", label: "Sent", icon: "inbox", render: renderSent },
    ],
  });
})();

/* ---------------------------------------------------------------- Birthdays */
async function renderBirthdays(host: HTMLElement) {
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { contacts: Contact[]; upcoming: Contact[]; ses_configured: boolean; stats: { total: number; upcoming: number; with_email: number } };
  try { data = await bvApi("/api/contacts"); sesOk = data.ses_configured; }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";

  host.append(statRow([
    { k: "Contacts", v: String(data.stats.total), icon: "users" },
    { k: "Birthdays ≤ 30 days", v: String(data.stats.upcoming), tone: "accent", icon: "cake" },
    { k: "With email", v: String(data.stats.with_email), icon: "message" },
  ]));

  if (data.upcoming.length) host.append(card({ title: "Coming up", body: h("div", { class: "bp-up" },
    ...data.upcoming.slice(0, 8).map((c) => h("div", { class: "bp-up-card" },
      h("div", { class: "bp-up-when" }, c.days_until === 0 ? "Today!" : c.days_until === 1 ? "Tomorrow" : `in ${c.days_until}d`),
      h("strong", null, c.name),
      h("div", { class: "bv-muted" }, fmtDate(c.birthday).replace(/,?\s*\d{4}$/, "")),
      c.email ? h("button", { class: "primary sm", disabled: !sesOk, onClick: () => send(c) }, "Send") : h("span", { class: "bv-muted bp-noemail" }, "no email")))) }));

  const add = h("button", { class: "primary", onClick: () => openContact() }, iconEl("plus", 15), "Add contact");
  host.append(card({ title: "All contacts", action: add, body: data.contacts.length ? dataTable<Contact>({
    columns: [
      { head: "Name", cell: (c) => h("strong", null, c.name) },
      { head: "Birthday", cell: (c) => fmtDate(c.birthday).replace(/,?\s*\d{4}$/, "") },
      { head: "Email", cell: (c) => h("span", { class: "bv-muted" }, c.email || "—") },
      { head: "Next", cell: (c) => pill(c.days_until === 0 ? "today" : `${c.days_until}d`, c.days_until <= 7 ? "accent" : undefined) },
    ],
    rows: data.contacts,
    rowActions: (c) => h("div", { class: "bp-row-actions" },
      c.email ? h("button", { class: "ghost sm", disabled: !sesOk, onClick: () => send(c) }, iconEl("send", 14)) : null,
      h("button", { class: "ghost sm", onClick: async () => { await bvApi(`/api/contacts/${c.id}`, { method: "DELETE" }); shell.select("birthdays"); } }, iconEl("trash", 14))),
  }) : emptyState({ icon: "cake", title: "No birthdays yet", text: "Add your regulars to send them a treat on their day." }) }));

  if (!sesOk) host.append(h("div", { class: "bp-warn" }, iconEl("alert", 15), "Email sending isn't configured yet — you can add contacts, but sends are disabled."));
}

async function send(c: Contact) {
  try { await bvApi(`/api/contacts/${c.id}/send`, { method: "POST" }); flash(`Birthday email sent to ${c.name}`, "success"); shell.select("birthdays"); }
  catch (err: any) { toast(err?.message || "Couldn't send", "error"); }
}

function openContact() {
  const name = h("input", { placeholder: "Customer name", autofocus: true }) as HTMLInputElement;
  const birthday = h("input", { type: "date" }) as HTMLInputElement;
  const email = h("input", { type: "email", placeholder: "Email (to send the treat)" }) as HTMLInputElement;
  const save = async () => {
    if (!name.value.trim() || !birthday.value) { toast("Name and birthday required", "warning"); return; }
    try { await bvApi("/api/contacts", { method: "POST", body: JSON.stringify({ name: name.value, birthday: birthday.value, email: email.value || null }) }); flash("Contact added", "success"); shell.select("birthdays"); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  };
  openModal({ title: "Add contact", body: h("div", { class: "bp-form" }, field("Name", name), field("Birthday", birthday), field("Email", email)), actions: [{ label: "Add", primary: true, onClick: () => { void save(); } }] });
}

/* ------------------------------------------------------------------ Message */
async function renderMessage(host: HTMLElement) {
  let s: Settings;
  try { const r = await bvApi<{ settings: Settings; ses_configured: boolean }>("/api/settings"); s = r.settings; sesOk = r.ses_configured; }
  catch (err: any) { host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }

  const subject = h("input", { value: s.subject }) as HTMLInputElement;
  const body = h("textarea", { rows: "3" }, s.body) as HTMLTextAreaElement;
  const code = h("input", { value: s.code, placeholder: "e.g. BDAY10", style: { textTransform: "uppercase" } }) as HTMLInputElement;
  const preview = h("div", { class: "bp-preview" });
  const renderPreview = () => {
    preview.innerHTML = "";
    preview.append(h("div", { class: "bp-mail" },
      h("div", { class: "bp-cake" }, "🎂"),
      h("h3", null, "Happy Birthday, Maria!"),
      h("p", null, (body.value || "").replace(/\{\{shop\}\}/g, merchantName).replace(/\{\{name\}\}/g, "Maria").replace(/\{\{code\}\}/g, code.value)),
      code.value ? h("div", { class: "bp-code" }, h("span", null, "Your gift code"), h("b", null, code.value.toUpperCase())) : null,
      h("div", { class: "bp-mail-foot" }, `with love from ${merchantName}`)));
  };
  [subject, body, code].forEach((el) => el.addEventListener("input", renderPreview));
  renderPreview();

  const save = h("button", { class: "primary", onClick: async () => {
    try { await bvApi("/api/settings", { method: "POST", body: JSON.stringify({ subject: subject.value, body: body.value, code: code.value }) }); flash("Message saved", "success"); }
    catch (err: any) { toast(err?.message || "error", "error"); }
  } }, "Save message");

  host.append(card({ title: "Birthday message", body: h("div", { class: "bp-msg" },
    h("div", null, field("Subject", subject), field("Body", body), field("Gift code", code),
      h("div", { class: "bp-hint bv-muted" }, "Use ", h("code", null, "{{name}}"), ", ", h("code", null, "{{shop}}"), ", ", h("code", null, "{{code}}"), " in your text."),
      h("div", { style: { marginTop: "12px" } }, save)),
    h("div", null, h("div", { class: "bv-label" }, "Preview"), preview)) }));
}

/* ---------------------------------------------------------------------- Sent */
async function renderSent(host: HTMLElement) {
  let log: LogRow[];
  try { log = (await bvApi<{ log: LogRow[] }>("/api/log")).log; }
  catch (err: any) { host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.append(card({ title: "Sent birthday emails", body: log.length ? dataTable<LogRow>({
    columns: [
      { head: "When", cell: (r) => h("span", { class: "bv-muted" }, relTime(r.created_at)) },
      { head: "To", cell: (r) => r.email },
      { head: "Code", cell: (r) => r.code ? pill(r.code, "primary") : "—" },
      { head: "By", cell: (r) => h("span", { class: "bv-muted" }, r.sent_by_name || "—") },
    ], rows: log,
  }) : emptyState({ icon: "inbox", title: "Nothing sent yet", text: "Send a birthday email from the Birthdays tab." }) }));
}

function field(label: string, el: HTMLElement) { return h("label", { class: "bp-field" }, h("span", { class: "bv-label" }, label), el); }
function fatal(msg?: string) { return h("div", { class: "bv-empty", style: { margin: "40px auto" } }, h("h3", null, "Birthday Promotions couldn't load"), h("p", null, msg || "Open this app from the Inkress dashboard.")); }
