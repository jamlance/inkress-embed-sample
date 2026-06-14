import { useState, type FormEvent } from "react";
import type { Route } from "./+types/pay";
import { useBv, useStorefront, useToast } from "@inkress/app-kit/client";
import { requireMerchant } from "~/lib/app-kit.server.mjs";

export async function loader(args: Route.LoaderArgs) {
  const { merchant } = requireMerchant(args); // gate the route
  return {
    username: (merchant as { username?: string }).username ?? null,
    currency: (merchant as { currency_code?: string }).currency_code ?? "JMD",
  };
}

export default function Pay({ loaderData }: Route.ComponentProps) {
  const { merchant } = useBv();
  const sf = useStorefront();
  const toast = useToast();
  const username = merchant?.username ?? loaderData.username;
  const currency = merchant?.currency_code ?? loaderData.currency ?? "JMD";

  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function generate(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setUrl(null);
    const total = Number(amount);
    if (!username) return setErr("Merchant username unavailable — open from the dashboard.");
    if (!Number.isFinite(total) || total <= 0) return setErr("Enter an amount greater than 0.");
    try {
      const link = sf.createPaymentUrl({
        username,
        total,
        currency_code: currency,
        title: title || `Payment to ${merchant?.name ?? "shop"}`,
        ...(email ? { customer: { email, phone: "" } } : {}),
      });
      setUrl(link);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="bv-card">
      <div className="bv-card-title">Payment link generator</div>
      <p className="bv-muted">
        Builds a real Inkress hosted-checkout URL with the <code>storefront-sdk</code>, client-side. Share it to get paid.
      </p>
      <form onSubmit={generate} style={{ marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
          <div className="bv-field">
            <label className="bv-label" htmlFor="amt">Amount ({currency})</label>
            <input className="bv-input" id="amt" inputMode="decimal" placeholder="2500" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="bv-field">
            <label className="bv-label" htmlFor="ttl">Title (optional)</label>
            <input className="bv-input" id="ttl" placeholder="Invoice #123" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="bv-field">
            <label className="bv-label" htmlFor="eml">Customer email (optional)</label>
            <input className="bv-input" id="eml" type="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        {err && <div className="bv-error">{err}</div>}
        <button className="bv-btn primary">Generate link</button>
      </form>

      {url && (
        <div className="bv-success">
          <div style={{ width: "100%" }}>
            <div className="bv-label">Payment URL</div>
            <a className="bv-link" href={url} target="_blank" rel="noopener">{url}</a>
            <div className="bv-row" style={{ marginTop: 10 }}>
              <button
                className="bv-btn sm"
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(url);
                  toast({ kind: "success", message: "Link copied" });
                }}
              >
                Copy
              </button>
              <a className="bv-btn sm primary" href={url} target="_blank" rel="noopener">Open checkout ↗</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
