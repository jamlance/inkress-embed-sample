import "./index.css";
import { initBv, makeToast } from "./bv-init";

(async () => {
  let session;
  try {
    session = await initBv();
  } catch (err: any) {
    document.getElementById("root")!.innerHTML = `
      <div class="bv-shell"><div class="bv-card" style="text-align:center;">
        <h1>Expense Logger couldn't load</h1>
        <p class="bv-muted">${err?.message || "Unknown error"}</p>
      </div></div>`;
    return;
  }
  const toast = makeToast(session.inkress);
  document.getElementById("root")!.innerHTML = `
    <div class="bv-shell">
      <header class="bv-header">
        <div>
          <h1>Expense Logger</h1>
          <p class="bv-muted">${session.merchant.name || session.merchant.username || "Merchant"}</p>
        </div>
        <span class="bv-pill">by Bookerva</span>
      </header>
      <div class="bv-card">
        <p>Expense Logger is loading…</p>
      </div>
    </div>`;
})();
