/**
 * Inkress embedded-app sample.
 *
 * Reference implementation that wires every primitive in
 * `@inkress/app-bridge` to a button + a live event log. Useful for:
 *
 *   - Verifying the host-side bridge runtime end-to-end on dev.
 *   - Copy-pasting working snippets into your own app.
 *
 * The app:
 *   1. Bootstraps the bridge (singleton).
 *   2. Renders the merchant + user identity returned by inkress.config.
 *   3. Wires buttons for: notify, confirm, modal, navigate (embed +
 *      host), clipboard, resize, session.refresh, session.exchange.
 *   4. Subscribes to host events and prints them in a live log.
 *
 * Source: github.com/jamlance/embed-sample
 * Bridge: github.com/jamlance/app-bridge
 */
import { createInkressApp, type InkressApp } from "@inkress/app-bridge";

const root = document.getElementById("root")!;

(async () => {
  let inkress: InkressApp;
  try {
    inkress = await createInkressApp();
  } catch (err) {
    renderFatal(err);
    return;
  }

  render(inkress);
})();

function renderFatal(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as any)?.code ?? "bootstrap_error";
  root.innerHTML = `
    <div class="boot">
      <div class="boot-card">
        <h1>Couldn't bootstrap the bridge</h1>
        <p class="muted">${escapeHtml(message)}</p>
        <p class="muted"><span class="mono">${escapeHtml(code)}</span></p>
        <p class="muted">
          This page must be opened from inside the Inkress dashboard.
          Direct loads are intentionally rejected — the bridge needs
          the session token from the embedded handoff.
        </p>
      </div>
    </div>`;
}

function render(inkress: InkressApp) {
  root.innerHTML = `
    <header class="app-header">
      <div>
        <h1>Inkress Embedded Sample</h1>
        <p class="muted">Exercises every primitive in @inkress/app-bridge.</p>
      </div>
      <span class="tag">v0.1.0</span>
    </header>

    <section class="panel">
      <h2>Identity</h2>
      <dl class="identity">
        <div>
          <dt>Merchant</dt>
          <dd id="ident-merchant">—</dd>
        </div>
        <div>
          <dt>Currency</dt>
          <dd id="ident-currency">—</dd>
        </div>
        <div>
          <dt>User</dt>
          <dd id="ident-user">—</dd>
        </div>
        <div>
          <dt>Theme · Locale</dt>
          <dd id="ident-theme">—</dd>
        </div>
      </dl>
      <h2 style="margin-top: 16px;">Granted scopes</h2>
      <div class="scopes" id="ident-scopes"></div>
    </section>

    <section class="panel" style="margin-top: 16px;">
      <h2>Notifications (toasts)</h2>
      <div class="row">
        <button class="success" data-cmd="notify-success">success</button>
        <button class="warning" data-cmd="notify-warning">warning</button>
        <button class="info" data-cmd="notify-info">info</button>
        <button class="error" data-cmd="notify-error">error</button>
        <button data-cmd="notify-rate">spam ×15 (rate-limit demo)</button>
      </div>
    </section>

    <section class="panel" style="margin-top: 16px;">
      <h2>Confirms &amp; modals</h2>
      <div class="row">
        <button class="primary" data-cmd="confirm">Confirm…</button>
        <button data-cmd="confirm-destructive">Destructive confirm…</button>
        <button data-cmd="modal">Open modal…</button>
        <button data-cmd="modal-close">Close any modal</button>
      </div>
    </section>

    <section class="panel" style="margin-top: 16px;">
      <h2>Navigation</h2>
      <div class="row">
        <button data-cmd="nav-embed-a">embed → /a</button>
        <button data-cmd="nav-embed-b">embed → /b</button>
        <button data-cmd="nav-embed-c">embed → /c/deep/path</button>
        <button data-cmd="nav-embed-root">embed → /</button>
        <button data-cmd="nav-host-orders">host → /dashboard/orders</button>
        <button data-cmd="nav-host-bad">host → /etc/evil (refused)</button>
      </div>
    </section>

    <section class="panel" style="margin-top: 16px;">
      <h2>Clipboard &amp; resize</h2>
      <div class="row">
        <input type="text" id="clip-text" value="hello from the sample" />
        <button data-cmd="clip">Copy</button>
      </div>
      <div class="row" style="margin-top: 8px;">
        <input type="number" id="resize-px" value="700" min="200" max="2000" />
        <button data-cmd="resize">Request height (px)</button>
        <button data-cmd="resize-tiny">Resize 50px (clamps to 200)</button>
      </div>
    </section>

    <section class="panel" style="margin-top: 16px;">
      <h2>Session</h2>
      <dl class="kv">
        <dt>Current token</dt>
        <dd id="sess-token">—</dd>
        <dt>Expires (unix)</dt>
        <dd id="sess-exp">—</dd>
      </dl>
      <div class="row" style="margin-top: 8px;">
        <button data-cmd="sess-refresh">Force refresh</button>
        <button data-cmd="sess-exchange" class="primary">Exchange for access token</button>
      </div>
      <div id="sess-exchange-out" class="token-box" hidden></div>
      <p class="muted" style="font-size: 12px; margin-top: 8px;">
        Exchange runs entirely in the browser for this demo — in
        production, route the call through your backend so
        <span class="mono">client_secret</span> stays server-side.
      </p>
    </section>

    <section class="panel" style="margin-top: 16px;">
      <h2>Event log</h2>
      <div id="event-log" class="event-log"></div>
    </section>
  `;

  // ---- Identity ------------------------------------------------------
  qs("#ident-merchant").textContent =
    `${inkress.merchant.name ?? "—"} (${inkress.merchant.username ?? "—"})`;
  qs("#ident-currency").textContent = inkress.merchant.currency_code ?? "—";
  qs("#ident-user").textContent = String(inkress.user.id ?? "—");
  qs("#ident-theme").textContent = `${inkress.theme} · ${inkress.locale}`;
  // API base populates if the host sent it in inkress.config.
  // session.exchange uses it to construct the token endpoint.
  const apiBase = inkress.apiBaseUrl ?? "—";
  console.info("[sample] apiBaseUrl", apiBase, "hostOrigin", inkress.hostOrigin);

  const scopesEl = qs("#ident-scopes");
  if (inkress.scopes.length === 0) {
    scopesEl.innerHTML = `<span class="muted">No scopes granted</span>`;
  } else {
    scopesEl.innerHTML = inkress.scopes
      .map((s) => `<span class="scope-pill">${escapeHtml(s)}</span>`)
      .join("");
  }

  // ---- Session display ----------------------------------------------
  const renderSession = () => {
    const s = inkress.session.current();
    qs("#sess-token").textContent = truncate(s.token, 24, 12);
    qs("#sess-exp").textContent = String(s.exp);
  };
  renderSession();
  inkress.session.onRefresh(() => {
    renderSession();
    log("session.refreshed", { exp: inkress.session.current().exp });
  });

  // ---- Event log ----------------------------------------------------
  const log = (type: string, payload?: unknown) => {
    const el = qs("#event-log");
    const ts = new Date().toISOString().slice(11, 23);
    const line = document.createElement("div");
    line.className = "line";
    line.innerHTML = `<span class="ts">${ts}</span><span class="ev">${escapeHtml(type)}</span>${payload !== undefined ? escapeHtml(JSON.stringify(payload)) : ""}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  };

  log("inkress.config", {
    merchant: inkress.merchant.id,
    scopes: inkress.scopes,
    hostOrigin: inkress.hostOrigin,
  });

  // ---- Subscribe to host events -------------------------------------
  inkress.events.on("route.changed", (payload) => {
    log("route.changed", payload);
  });
  inkress.events.on("theme.changed", (payload) => {
    log("theme.changed", payload);
  });

  // ---- Wire all buttons ---------------------------------------------
  document.body.addEventListener("click", async (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-cmd]");
    if (!target) return;
    const cmd = target.dataset.cmd;
    try {
      await runCommand(cmd ?? "", inkress, log);
    } catch (err: any) {
      log("error", { cmd, code: err?.code ?? "unknown", message: err?.message });
    }
  });
}

async function runCommand(
  cmd: string,
  inkress: InkressApp,
  log: (type: string, payload?: unknown) => void,
) {
  switch (cmd) {
    case "notify-success":
      inkress.notify({ kind: "success", message: "All good!" });
      log("→ notify", { kind: "success" });
      return;
    case "notify-warning":
      inkress.notify({ kind: "warning", message: "Heads up." });
      log("→ notify", { kind: "warning" });
      return;
    case "notify-info":
      inkress.notify({ kind: "info", message: "FYI from the sample." });
      log("→ notify", { kind: "info" });
      return;
    case "notify-error":
      inkress.notify({ kind: "error", message: "Something broke." });
      log("→ notify", { kind: "error" });
      return;
    case "notify-rate": {
      // 15 in rapid sequence — bucket capacity is 10, so the last 5
      // should return inkress.error with code rate_limited.
      for (let i = 0; i < 15; i += 1) {
        inkress.notify({ kind: "info", message: `Spam #${i + 1}` });
      }
      log("→ notify ×15", "watch the rate limits");
      return;
    }
    case "confirm": {
      const ok = await inkress.confirm({
        title: "Run this action?",
        body: "Friendly confirmation prompt — no consequences.",
        confirm_label: "Run it",
      });
      log("← confirm.result", { confirmed: ok });
      return;
    }
    case "confirm-destructive": {
      const ok = await inkress.confirm({
        title: "Refund order?",
        body: "This refunds $100 USD. Cannot be undone.",
        confirm_label: "Refund",
        destructive: true,
      });
      log("← confirm.result", { confirmed: ok, destructive: true });
      return;
    }
    case "modal": {
      const result = await inkress.modal.open({
        title: "Pick an action",
        body: "Modals can carry a primary + secondary action. Closing the dialog returns 'dismiss'.",
        primary_action: { label: "Run primary" },
        secondary_action: { label: "Cancel" },
      });
      log("← modal.result", { action: result });
      return;
    }
    case "modal-close":
      inkress.modal.close();
      log("→ modal.close");
      return;
    case "nav-embed-a":
      inkress.navigate.embed("/a");
      log("→ navigate.embed", { path: "/a" });
      return;
    case "nav-embed-b":
      inkress.navigate.embed("/b");
      log("→ navigate.embed", { path: "/b" });
      return;
    case "nav-embed-c":
      inkress.navigate.embed("/c/deep/path");
      log("→ navigate.embed", { path: "/c/deep/path" });
      return;
    case "nav-embed-root":
      inkress.navigate.embed("/");
      log("→ navigate.embed", { path: "/" });
      return;
    case "nav-host-orders":
      inkress.navigate.host("/dashboard/orders");
      log("→ navigate.host", { path: "/dashboard/orders" });
      return;
    case "nav-host-bad":
      // The SDK refuses paths outside /dashboard/ client-side, so this
      // never reaches the host — proof that the guard lives in the SDK.
      inkress.navigate.host("/etc/evil");
      log("→ navigate.host (refused)", { path: "/etc/evil" });
      return;
    case "clip": {
      const text = (qs<HTMLInputElement>("#clip-text").value || "").toString();
      const r = await inkress.clipboard.write(text);
      log("← clipboard.result", r);
      return;
    }
    case "resize": {
      const v = Number(qs<HTMLInputElement>("#resize-px").value);
      inkress.resize(v);
      log("→ resize", { height: v });
      return;
    }
    case "resize-tiny":
      inkress.resize(50);
      log("→ resize", { height: 50, note: "host clamps to 200" });
      return;
    case "sess-refresh": {
      const s = await inkress.session.refresh();
      log("← session.refresh", { exp: s.exp });
      return;
    }
    case "sess-exchange": {
      const clientId = window.prompt(
        "client_id (inkid_…) for this embedded app:",
      );
      if (!clientId) return;
      const clientSecret = window.prompt(
        "client_secret (only for the demo — production code keeps this on the server):",
      );
      if (!clientSecret) return;
      try {
        const r = await inkress.session.exchange({ clientId, clientSecret });
        log("← session.exchange", {
          access_token: truncate(r.access_token, 12, 6),
          expires_in: r.expires_in,
          scope: r.scope,
        });
        const out = qs<HTMLDivElement>("#sess-exchange-out");
        out.hidden = false;
        out.textContent = JSON.stringify(r, null, 2);
      } catch (err: any) {
        log("← session.exchange error", {
          code: err?.code,
          message: err?.message,
        });
      }
      return;
    }
    default:
      log("unknown command", { cmd });
  }
}

// ---- Helpers --------------------------------------------------------

function qs<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Selector not found: ${sel}`);
  return el;
}

function truncate(s: string, head = 8, tail = 4): string {
  if (!s) return "—";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
