import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

interface Doc { id: number; label: string; attached_to: string | null; attached_id: string | null; filename: string; content_type: string | null; size: number; created_at: string; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";

(async () => {
  let session;
  try { session = await initBv(); }
  catch (err: any) { root.innerHTML = fatal("Document Vault", err?.message); return; }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  renderShell();
  await refresh();
})();

function renderShell() {
  root.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div><h1>Document Vault</h1><p class="bv-muted">${esc(merchantName)} · store contracts, receipts &amp; IDs securely</p></div>
        <span class="bv-pill">by Bookerva</span>
      </header>
      <div id="stats" class="bv-grid bv-grid-2" style="margin-bottom:16px;">${statSkel(2)}</div>
      <div class="bv-card">
        <h2 style="margin-top:0;">Upload a document</h2>
        <form id="up-form" class="bv-stack" style="max-width:600px;">
          <div class="bv-grid bv-grid-2">
            <div><label class="bv-label">Label</label><input id="f-label" placeholder="Signed delivery receipt" /></div>
            <div><label class="bv-label">Attach to (optional)</label><input id="f-attach" placeholder="Order #1234" /></div>
          </div>
          <div><label class="bv-label">File (max 8MB)</label><input id="f-file" type="file" /></div>
          <div class="bv-row"><button type="submit" class="primary">Upload</button></div>
        </form>
      </div>
      <h2 class="bv-section-title">Documents</h2>
      <div id="list" class="bv-card"><div class="bv-skeleton" style="width:70%;"></div></div>
    </div>`;
  document.getElementById("up-form")!.addEventListener("submit", onUpload);
}

async function refresh() {
  try {
    const { docs, stats } = await bvApi<{ docs: Doc[]; stats: any }>("/api/docs");
    document.getElementById("stats")!.innerHTML =
      statCard("Documents", String(stats.documents)) + statCard("Total stored", fmtSize(stats.total_size));
    const el = document.getElementById("list")!;
    if (!docs.length) { el.innerHTML = `<div class="bv-empty">No documents yet. Upload your first above.</div>`; return; }
    el.innerHTML = `<table class="bv-table"><thead><tr><th>Label</th><th>File</th><th>Attached</th><th>Size</th><th>Date</th><th></th></tr></thead>
      <tbody>${docs.map((d) => `<tr>
        <td><strong>${esc(d.label)}</strong></td>
        <td class="bv-muted">${esc(d.filename)}</td>
        <td class="bv-muted">${esc(d.attached_to || "—")}</td>
        <td>${fmtSize(d.size)}</td>
        <td class="bv-muted">${esc(d.created_at.slice(0, 10))}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button data-dl="${d.id}" data-name="${esc(d.filename)}">Download</button>
          <button data-del="${d.id}" class="destructive">Delete</button>
        </td></tr>`).join("")}</tbody></table>`;
    el.querySelectorAll<HTMLButtonElement>("button[data-dl]").forEach((b) => b.addEventListener("click", () => onDownload(b.dataset.dl!, b.dataset.name!)));
    el.querySelectorAll<HTMLButtonElement>("button[data-del]").forEach((b) => b.addEventListener("click", () => onDelete(b.dataset.del!)));
  } catch (err: any) { document.getElementById("list")!.innerHTML = `<div class="bv-empty">Couldn't load: ${esc(err?.message || "error")}</div>`; }
}

async function onUpload(e: Event) {
  e.preventDefault();
  const fileInput = document.getElementById("f-file") as HTMLInputElement;
  const file = fileInput.files?.[0];
  if (!file) { toast("Pick a file first", "warning"); return; }
  if (file.size > 8 * 1024 * 1024) { toast("File exceeds 8MB", "error"); return; }
  const label = (document.getElementById("f-label") as HTMLInputElement).value;
  const attach = (document.getElementById("f-attach") as HTMLInputElement).value || null;
  const dataB64 = await fileToBase64(file);
  try {
    await bvApi("/api/docs", { method: "POST", body: JSON.stringify({
      label, attached_to: attach, filename: file.name, content_type: file.type, data_base64: dataB64,
    }) });
    toast("Uploaded", "success");
    (document.getElementById("up-form") as HTMLFormElement).reset();
    await refresh();
  } catch (err: any) { toast(err?.message || "Upload failed", "error"); }
}

async function onDelete(id: string) {
  try { await bvApi(`/api/docs/${id}`, { method: "DELETE" }); toast("Deleted", "success"); await refresh(); }
  catch (err: any) { toast(err?.message || "error", "error"); }
}

async function onDownload(id: string, filename: string) {
  // Anchor downloads can't carry the X-BV-Session header, so fetch the
  // file with the header and stream it into a blob URL.
  const sessionId = sessionStorage.getItem("bv_app_session_id") || "";
  try {
    const r = await fetch(`/api/docs/${id}/download`, { headers: { "X-BV-Session": sessionId } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  } catch (err: any) { toast(err?.message || "Download failed", "error"); }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function fmtSize(n: number) { if (n < 1024) return `${n} B`; if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1024 / 1024).toFixed(1)} MB`; }
function statCard(l: string, v: string) { return `<div class="bv-card"><div class="bv-label">${esc(l)}</div><div style="font-size:24px;font-weight:600;">${esc(v)}</div></div>`; }
function statSkel(n: number) { return Array.from({ length: n }).map(() => `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div><div class="bv-skeleton" style="height:24px;width:40%;margin-top:6px;"></div></div>`).join(""); }
function fatal(t: string, m?: string) { return `<div class="bv-shell"><div class="bv-card" style="text-align:center;"><h1>${esc(t)} couldn't load</h1><p class="bv-muted">${esc(m || "Unknown error")}</p></div></div>`; }
function esc(s: string) { return String(s).replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"); }
