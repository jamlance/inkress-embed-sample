import "./index.css";
import { initBv, bvApi, makeToast, type BvToastFn } from "./bv-init";

interface Code {
  id: number;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  currency: string | null;
  min_order: number;
  max_uses: number;
  used_count: number;
  starts_at: string | null;
  ends_at: string | null;
  active: number;
}
interface Stats {
  total: number;
  active: number;
  redemptions: number;
}

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";

(async () => {
  let session;
  try {
    session = await initBv();
  } catch (err: any) {
    root.innerHTML = fatal("Promo Codes", err?.message);
    return;
  }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  renderShell();
  await refresh();
})();

function renderShell() {
  root.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div>
          <h1>Promo Codes</h1>
          <p class="bv-muted">${esc(merchantName)} · discount codes for your checkout</p>
        </div>
        <span class="bv-pill">by Bookerva</span>
      </header>

      <div id="stats" class="bv-grid bv-grid-3" style="margin-bottom:16px;">${statSkeleton()}</div>

      <div class="bv-card">
        <h2 style="margin-top:0;">Create a code</h2>
        <form id="create-form" class="bv-stack" style="max-width:520px;">
          <div class="bv-grid bv-grid-2">
            <div>
              <label class="bv-label">Code</label>
              <input id="f-code" placeholder="SUMMER20" autocomplete="off" />
            </div>
            <div>
              <label class="bv-label">Type</label>
              <select id="f-kind">
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed amount off</option>
              </select>
            </div>
          </div>
          <div class="bv-grid bv-grid-2">
            <div>
              <label class="bv-label">Value</label>
              <input id="f-value" type="number" step="0.01" placeholder="20" />
            </div>
            <div>
              <label class="bv-label">Min order (optional)</label>
              <input id="f-min" type="number" step="0.01" placeholder="0" />
            </div>
          </div>
          <div class="bv-grid bv-grid-2">
            <div>
              <label class="bv-label">Max uses (0 = unlimited)</label>
              <input id="f-max" type="number" step="1" placeholder="0" />
            </div>
            <div>
              <label class="bv-label">Expires (optional)</label>
              <input id="f-ends" type="date" />
            </div>
          </div>
          <div class="bv-row">
            <button type="submit" class="primary">Create code</button>
          </div>
        </form>
      </div>

      <h2 class="bv-section-title">Your codes</h2>
      <div id="list" class="bv-card">${listSkeleton()}</div>
    </div>`;

  document.getElementById("create-form")!.addEventListener("submit", onCreate);
}

async function refresh() {
  try {
    const { codes, stats } = await bvApi<{ codes: Code[]; stats: Stats }>("/api/codes");
    renderStats(stats);
    renderList(codes);
  } catch (err: any) {
    document.getElementById("list")!.innerHTML =
      `<div class="bv-empty">Couldn't load codes: ${esc(err?.message || "error")}</div>`;
  }
}

function renderStats(s: Stats) {
  document.getElementById("stats")!.innerHTML = `
    ${statCard("Total codes", String(s.total))}
    ${statCard("Active now", String(s.active))}
    ${statCard("Redemptions", String(s.redemptions))}`;
}

function renderList(codes: Code[]) {
  const el = document.getElementById("list")!;
  if (!codes.length) {
    el.innerHTML = `<div class="bv-empty">No promo codes yet. Create your first one above.</div>`;
    return;
  }
  el.innerHTML = `
    <table class="bv-table">
      <thead><tr>
        <th>Code</th><th>Discount</th><th>Used</th><th>Limits</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${codes
          .map((c) => {
            const discount =
              c.kind === "percent" ? `${c.value}% off` : `${c.value.toFixed(2)} off`;
            const limits: string[] = [];
            if (c.min_order > 0) limits.push(`min ${c.min_order}`);
            if (c.max_uses > 0) limits.push(`${c.max_uses} uses`);
            if (c.ends_at) limits.push(`till ${c.ends_at}`);
            return `
            <tr>
              <td><span class="bv-mono">${esc(c.code)}</span></td>
              <td>${discount}</td>
              <td>${c.used_count}${c.max_uses ? ` / ${c.max_uses}` : ""}</td>
              <td class="bv-muted">${limits.join(" · ") || "—"}</td>
              <td><span class="bv-pill" data-tone="${c.active ? "success" : ""}">${c.active ? "Active" : "Paused"}</span></td>
              <td style="text-align:right;white-space:nowrap;">
                <button data-act="toggle" data-id="${c.id}" data-active="${c.active}">${c.active ? "Pause" : "Activate"}</button>
                <button data-act="delete" data-id="${c.id}" class="destructive">Delete</button>
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;

  el.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => onRowAction(btn));
  });
}

async function onCreate(e: Event) {
  e.preventDefault();
  const body = {
    code: (document.getElementById("f-code") as HTMLInputElement).value,
    kind: (document.getElementById("f-kind") as HTMLSelectElement).value,
    value: (document.getElementById("f-value") as HTMLInputElement).value,
    min_order: (document.getElementById("f-min") as HTMLInputElement).value,
    max_uses: (document.getElementById("f-max") as HTMLInputElement).value,
    ends_at: (document.getElementById("f-ends") as HTMLInputElement).value || null,
  };
  try {
    await bvApi("/api/codes", { method: "POST", body: JSON.stringify(body) });
    toast("Code created", "success");
    (document.getElementById("create-form") as HTMLFormElement).reset();
    await refresh();
  } catch (err: any) {
    toast(err?.message || "Couldn't create code", "error");
  }
}

async function onRowAction(btn: HTMLButtonElement) {
  const id = btn.dataset.id!;
  const act = btn.dataset.act!;
  try {
    if (act === "toggle") {
      const active = btn.dataset.active === "1" ? 0 : 1;
      await bvApi(`/api/codes/${id}`, { method: "PATCH", body: JSON.stringify({ active }) });
    } else if (act === "delete") {
      await bvApi(`/api/codes/${id}`, { method: "DELETE" });
      toast("Code deleted", "success");
    }
    await refresh();
  } catch (err: any) {
    toast(err?.message || "Action failed", "error");
  }
}

function statCard(label: string, value: string) {
  return `<div class="bv-card"><div class="bv-label">${esc(label)}</div>
    <div style="font-size:24px;font-weight:600;">${esc(value)}</div></div>`;
}
function statSkeleton() {
  return Array.from({ length: 3 })
    .map(() => `<div class="bv-card"><div class="bv-skeleton" style="width:50%;"></div>
      <div class="bv-skeleton" style="height:24px;width:40%;margin-top:6px;"></div></div>`)
    .join("");
}
function listSkeleton() {
  return `<div class="bv-skeleton" style="width:80%;margin-bottom:8px;"></div>
    <div class="bv-skeleton" style="width:60%;"></div>`;
}
function fatal(title: string, msg?: string) {
  return `<div class="bv-shell"><div class="bv-card" style="text-align:center;">
    <h1>${esc(title)} couldn't load</h1><p class="bv-muted">${esc(msg || "Unknown error")}</p></div></div>`;
}
function esc(s: string) {
  return String(s).replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;");
}
