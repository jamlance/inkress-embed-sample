import "./index.css";
import {
  initBv,
  bvApi,
  mountShell,
  h,
  flash,
  icon,
  type BvSession,
} from "./bv-init";

const root = document.getElementById("root")!;

(async () => {
  let session: BvSession;
  try {
    session = await initBv();
  } catch (err: any) {
    root.innerHTML = "";
    root.append(fatal(err?.message));
    return;
  }

  const merchantName =
    session.merchant.name || session.merchant.username || "Merchant";

  mountShell({
    brandIcon: "calendar",
    title: "Bookerva",
    subtitle: `${merchantName} · appointments & bookings`,
    poweredBy: "Marketplace",
    tabs: [{ id: "bookings", label: "Bookings", icon: "calendar", render: renderBookings }],
  });
})();

/**
 * Single tab: render an <iframe> whose src is a JWT-signed deep link into
 * the Bookerva /embed/{vertical} surface. The Bookerva side handles the rest
 * (services, appointments, public booking page, etc.) — see docs §13 in the
 * bookerva repo.
 */
async function renderBookings(host: HTMLElement) {
  host.innerHTML = "";
  const frame = document.createElement("iframe");
  frame.className = "bv-bookerva-frame";
  // Permit inputs + clipboard for the share-link panel inside Bookerva.
  frame.setAttribute("allow", "clipboard-write");
  host.append(frame);

  try {
    const params = new URLSearchParams(window.location.search);
    const vertical = params.get("vertical") || "generic";
    const { url } = await bvApi<{ url: string }>(
      `/api/bookerva-url?vertical=${encodeURIComponent(vertical)}`,
    );
    if (!url) throw new Error("Server didn't return a Bookerva URL.");
    frame.src = url;
  } catch (err: any) {
    host.innerHTML = "";
    const div = document.createElement("div");
    div.className = "bv-bookerva-err";
    div.textContent = `Couldn't open Bookerva: ${err?.message ?? err}`;
    host.append(div);
    flash(err?.message ?? "Bookerva failed to load.", "error");
  }
}

function fatal(message?: string) {
  return h(
    "div",
    { class: "bv-shell" },
    h(
      "div",
      { class: "bv-card" },
      h("h2", null, icon("alert", 18) as any, "Couldn't start"),
      h(
        "div",
        { class: "bv-muted", style: { marginTop: "8px" } },
        message ?? "Unknown error",
      ),
    ),
  );
}
