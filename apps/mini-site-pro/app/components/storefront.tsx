import { useState, type CSSProperties } from "react";
import { THEMES, DEFAULT_THEME, arr, money } from "~/lib/blocks.mjs";

export type StoreProduct = {
  id: number;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  image_url?: string | null;
};
export type StoreSite = {
  handle: string;
  business_name?: string | null;
  tagline?: string | null;
  accent?: string | null;
  theme?: string | null;
  logo?: string | null;
  hero_image?: string | null;
  cta_label?: string | null;
  show_social_proof?: boolean;
  currency?: string | null;
  sections: { id: string; type: string; data: any }[];
};

const initials = (s?: string | null) =>
  String(s || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

function Placeholder({ heading, hint, preview }: { heading?: string; hint: string; preview?: boolean }) {
  if (!preview) return null;
  return (
    <section className="mk-store-band">
      <div className="mk-store-wrap mk-store-ph">
        {heading && <h2 className="mk-store-h2">{heading}</h2>}
        <p>{hint}</p>
      </div>
    </section>
  );
}

/** The public storefront, rendered from block data. Used by the /s/:handle route
 *  (SSR) AND by the builder's live preview (client). `preview` shows placeholders
 *  for empty blocks and makes Order buttons inert. */
export function Storefront({
  site,
  products,
  paidCount = 0,
  preview = false,
}: {
  site: StoreSite;
  products: StoreProduct[];
  paidCount?: number;
  preview?: boolean;
}) {
  const [order, setOrder] = useState<StoreProduct | null>(null);
  const theme = (THEMES as Record<string, any>)[site.theme || DEFAULT_THEME] || (THEMES as any)[DEFAULT_THEME];
  const accent = site.accent || theme.accent;
  const sections = arr(site.sections);

  const rootStyle: CSSProperties = {
    ["--accent" as any]: accent,
    ["--accent-tint" as any]: `color-mix(in oklch, ${accent} 14%, var(--mk-surface))`,
    ["--accent-wash" as any]: `color-mix(in oklch, ${accent} 7%, var(--mk-bg))`,
    ["--accent-line" as any]: `color-mix(in oklch, ${accent} 26%, var(--mk-border))`,
  };

  const renderBlock = (b: { id: string; type: string; data: any }, idx: number) => {
    const d = b.data || {};
    switch (b.type) {
      case "hero": {
        const img = d.image || site.hero_image;
        const title = d.title || site.business_name || "Shop";
        const sub = d.subtitle || site.tagline || "";
        const href = d.cta_target === "contact" ? "#contact" : "#products";
        const align = theme.align === "center" ? "center" : "left";
        return (
          <header key={b.id} className={`mk-store-hero is-${align} ${img ? "has-img" : "no-img"}`}>
            {img && <div className="mk-store-hero-img" style={{ backgroundImage: `url('${img}')` }} aria-hidden />}
            <div className="mk-store-hero-inner">
              <div className="mk-store-brandrow">
                {site.logo ? (
                  <img className="mk-store-logo" src={site.logo} alt="" />
                ) : (
                  <span className="mk-store-logo ph" aria-hidden>{initials(title)}</span>
                )}
                {site.show_social_proof !== false && paidCount > 0 && (
                  <span className="mk-store-proof">{paidCount} order{paidCount === 1 ? "" : "s"} fulfilled</span>
                )}
              </div>
              <h1 className="mk-store-title">{title}</h1>
              {sub && <p className="mk-store-sub">{sub}</p>}
              {products.length > 0 && (
                <div className="mk-store-herocta">
                  <a className="mk-store-cta" href={href}>{d.cta_label || site.cta_label || "Shop now"}</a>
                  <a className="mk-store-cta2" href="#contact">Contact</a>
                </div>
              )}
            </div>
          </header>
        );
      }
      case "products":
        if (!products.length) return <Placeholder key={b.id} heading={d.heading || "Shop"} hint="Products you add appear here." preview={preview} />;
        return (
          <section key={b.id} className="mk-store-band" id="products">
            <div className="mk-store-wrap">
              <div className="mk-store-head">
                <h2 className="mk-store-h2">{d.heading || "Shop"}</h2>
                <span className="mk-store-count">{products.length} item{products.length === 1 ? "" : "s"}</span>
              </div>
              <div className="mk-store-grid">
                {products.map((p) => (
                  <article key={p.id} className="mk-store-card">
                    {p.image_url ? (
                      <div className="mk-store-thumb" style={{ backgroundImage: `url('${p.image_url}')` }} />
                    ) : (
                      <div className="mk-store-thumb ph">{initials(p.name)}</div>
                    )}
                    <div className="mk-store-cbody">
                      <h3 className="mk-store-pname">{p.name}</h3>
                      {p.description && <p className="mk-store-pdesc">{p.description}</p>}
                      <div className="mk-store-prow">
                        <span className="mk-store-price tnum">{money(p.price, p.currency)}</span>
                        <button className="mk-store-buy" type="button" disabled={preview} onClick={() => !preview && setOrder(p)}>
                          Order
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        );
      case "text":
        if (!d.heading && !d.body) return <Placeholder key={b.id} heading={d.heading} hint="Add a heading and text in the editor." preview={preview} />;
        return (
          <section key={b.id} className={`mk-store-band ${idx % 2 ? "alt" : ""}`}>
            <div className="mk-store-wrap mk-store-prose">
              {d.heading && <h2 className="mk-store-h2">{d.heading}</h2>}
              <div className="mk-store-about">{d.body}</div>
            </div>
          </section>
        );
      case "gallery": {
        const imgs = arr(d.images);
        if (!imgs.length) return <Placeholder key={b.id} heading={d.heading} hint="Add images in the editor." preview={preview} />;
        return (
          <section key={b.id} className="mk-store-band">
            <div className="mk-store-wrap">
              {d.heading && <h2 className="mk-store-h2">{d.heading}</h2>}
              <div className="mk-store-gal">
                {imgs.map((u: string, i: number) => (
                  <div key={i} className="mk-store-gphoto" style={{ backgroundImage: `url('${u}')` }} />
                ))}
              </div>
            </div>
          </section>
        );
      }
      case "links": {
        const links = arr(d.links);
        if (!links.length) return <Placeholder key={b.id} heading={d.heading} hint="Add links in the editor." preview={preview} />;
        return (
          <section key={b.id} className={`mk-store-band ${idx % 2 ? "alt" : ""}`}>
            <div className="mk-store-wrap">
              {d.heading && <h2 className="mk-store-h2">{d.heading}</h2>}
              <div className="mk-store-links">
                {links.map((l: any, i: number) => (
                  <a key={i} className="mk-store-chip" href={l.url} target="_blank" rel="noopener">
                    {l.label}
                    <span aria-hidden>↗</span>
                  </a>
                ))}
              </div>
            </div>
          </section>
        );
      }
      case "contact":
        if (!d.phone && !d.email && !d.address) return <Placeholder key={b.id} heading={d.heading} hint="Add contact details in the editor." preview={preview} />;
        return (
          <section key={b.id} className={`mk-store-band ${idx % 2 ? "alt" : ""}`} id="contact">
            <div className="mk-store-wrap mk-store-contactwrap">
              {d.heading && <h2 className="mk-store-h2">{d.heading}</h2>}
              <div className="mk-store-contact">
                {d.phone && (
                  <a className="mk-store-crow" href={`tel:${String(d.phone).replace(/\s+/g, "")}`}>
                    <span className="mk-store-cico" aria-hidden>✆</span>
                    <span>{d.phone}</span>
                  </a>
                )}
                {d.email && (
                  <a className="mk-store-crow" href={`mailto:${d.email}`}>
                    <span className="mk-store-cico" aria-hidden>✉</span>
                    <span>{d.email}</span>
                  </a>
                )}
                {d.address && (
                  <div className="mk-store-crow">
                    <span className="mk-store-cico" aria-hidden>◎</span>
                    <span>{d.address}</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      case "hours": {
        const rows = arr(d.rows);
        if (!rows.length) return <Placeholder key={b.id} heading={d.heading} hint="Add opening hours in the editor." preview={preview} />;
        return (
          <section key={b.id} className={`mk-store-band ${idx % 2 ? "alt" : ""}`}>
            <div className="mk-store-wrap mk-store-hourswrap">
              {d.heading && <h2 className="mk-store-h2">{d.heading}</h2>}
              <dl className="mk-store-hours">
                {rows.map((r: any, i: number) => (
                  <div key={i} className="mk-store-hrow">
                    <dt>{r.label}</dt>
                    <dd className="tnum">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        );
      }
      case "testimonials": {
        const items = arr(d.items);
        if (!items.length) return <Placeholder key={b.id} heading={d.heading} hint="Add customer quotes in the editor." preview={preview} />;
        return (
          <section key={b.id} className="mk-store-band">
            <div className="mk-store-wrap">
              {d.heading && <h2 className="mk-store-h2">{d.heading}</h2>}
              <div className="mk-store-tg">
                {items.map((it: any, i: number) => (
                  <figure key={i} className="mk-store-tcard">
                    <span className="mk-store-quote" aria-hidden>&ldquo;</span>
                    <blockquote>{it.quote}</blockquote>
                    {it.author && <figcaption>{it.author}</figcaption>}
                  </figure>
                ))}
              </div>
            </div>
          </section>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="mk-store" style={rootStyle}>
      {sections.map(renderBlock)}
      <footer className="mk-store-foot">
        <span>{site.business_name}</span>
        <span className="mk-store-foot-by">Powered by Inkress</span>
      </footer>
      {order && !preview && <CheckoutModal site={site} product={order} onClose={() => setOrder(null)} />}
    </div>
  );
}

function CheckoutModal({ site, product, onClose }: { site: StoreSite; product: StoreProduct; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (busy) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setErr("Enter a valid email.");
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch("/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: site.handle, product_id: product.id, name, email }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.payment_url) {
        window.top ? (window.top.location.href = j.payment_url) : (window.location.href = j.payment_url);
        return;
      }
      setErr(j.message || "We couldn’t start checkout. Please try again.");
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mk-store-modal" onClick={() => !busy && onClose()}>
      <div className="mk-store-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Order ${product.name}`}>
        <button className="mk-store-x" onClick={() => !busy && onClose()} aria-label="Close">×</button>
        <div className="mk-store-sheet-lead">
          <span className="mk-store-sheet-k">You’re ordering</span>
          <h3 className="mk-store-sheet-name">{product.name}</h3>
          <div className="mk-store-mprice tnum">{money(product.price, product.currency)}</div>
        </div>
        <label htmlFor="cn">Your name</label>
        <input id="cn" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="ce">Email for the receipt</label>
        <input id="ce" type="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby="merr" />
        {err && <div id="merr" className="mk-store-err" role="alert">{err}</div>}
        <button className="mk-store-go" disabled={busy} onClick={go}>{busy ? "Creating your order…" : "Continue to payment"}</button>
        <p className="mk-store-secure">Secure checkout by Inkress</p>
      </div>
    </div>
  );
}
