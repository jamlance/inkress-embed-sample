import { Form, useNavigation } from "react-router";
import { desc, eq } from "drizzle-orm";
import type { Route } from "./+types/notes";
import { appKit, requireMerchant } from "~/lib/app-kit.server.mjs";
import { notes } from "~/db/schema.server.mjs";
import { shortDate } from "~/lib/format";

export async function loader(args: Route.LoaderArgs) {
  const { merchantId } = requireMerchant(args); // throws → reauth when no session
  const storage = appKit.storage;
  const rows = storage
    ? await storage.db.select().from(notes).where(eq(notes.merchantId, merchantId)).orderBy(desc(notes.id)).limit(20)
    : [];
  return { notes: rows, hasDb: Boolean(storage) };
}

export async function action(args: Route.ActionArgs) {
  const { merchantId } = requireMerchant(args);
  const form = await args.request.formData();
  const body = String(form.get("body") || "").trim();
  if (!body) return { error: "Note can’t be empty." };
  const storage = appKit.storage;
  if (!storage) return { error: "No database configured (set APPS_DATABASE_URL)." };
  await storage.db.insert(notes).values({ merchantId, body });
  return { ok: true as const };
}

export default function Notes({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  return (
    <>
      {!loaderData.hasDb && (
        <div className="bv-banner">No database configured — set APPS_DATABASE_URL to persist notes.</div>
      )}
      <div className="bv-card">
        <div className="bv-card-title">Add a note</div>
        <p className="bv-muted">A per-merchant row written through the Drizzle storage adapter in a route action.</p>
        <Form method="post" key={actionData && "ok" in actionData ? "reset" : "form"} style={{ marginTop: 12 }}>
          <div className="bv-field">
            <input className="bv-input" id="body" name="body" placeholder="Type a note…" autoComplete="off" />
          </div>
          {actionData && "error" in actionData && <div className="bv-error">{actionData.error}</div>}
          <button className="bv-btn primary" disabled={busy}>
            {busy ? "Saving…" : "Add note"}
          </button>
        </Form>
      </div>

      <div className="bv-card">
        <div className="bv-card-title">Recent notes</div>
        {loaderData.notes.length === 0 ? (
          <div className="bv-empty">
            <p className="bv-muted">No notes yet.</p>
          </div>
        ) : (
          <table className="bv-table">
            <tbody>
              {loaderData.notes.map((n: { id: number; body: string; createdAt: string | Date }) => (
                <tr key={n.id}>
                  <td>{n.body}</td>
                  <td className="num bv-muted">{shortDate(n.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
