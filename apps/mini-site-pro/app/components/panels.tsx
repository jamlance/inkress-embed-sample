// Shell-agnostic editor panels: Products, Theme, Page, Settings. Each is a plain
// editing surface used identically by both the studio and sidebar shells.
import { useState } from "react";
import { THEMES } from "~/lib/blocks.mjs";
import { money } from "~/lib/blocks.mjs";
import { Modal, Field } from "~/components/ui";
import { ImageUpload } from "~/components/image-upload";

const postJSON = (url: string, body: any) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type SiteState = {
  handle: string;
  published: boolean;
  businessName: string;
  tagline: string;
  about: string;
  logo: string;
  accent: string;
  theme: string;
  currency: string;
};

export type Product = { id: number; name: string; description: string | null; price: number; currency: string; image_url: string | null; active: boolean };
export type CatalogItem = { id: string; title: string; description: string | null; price: number; image: string | null; currency: string };

/* ───────────────────────── Theme ───────────────────────── */
export function ThemePanel({ site, patch }: { site: SiteState; patch: (p: Partial<SiteState>) => void }) {
  return (
    <div className="mk-panel">
      <div className="mk-panel-head">
        <div>
          <h2 className="mk-panel-title">Brand &amp; theme</h2>
          <p className="mk-panel-sub">Your name, look, and colours. Changes preview live.</p>
        </div>
      </div>
      <div className="mk-formgrid">
        <Field label="Business name"><input className="bv-input" value={site.businessName} onChange={(e) => patch({ businessName: e.target.value })} /></Field>
        <Field label="Tagline"><input className="bv-input" placeholder="A short tagline" value={site.tagline} onChange={(e) => patch({ tagline: e.target.value })} /></Field>
      </div>
      <Field label="About" hint="Shown if you add a Text block."><textarea className="bv-input" rows={3} value={site.about} onChange={(e) => patch({ about: e.target.value })} /></Field>
      <ImageUpload label="Logo" value={site.logo} onChange={(v) => patch({ logo: v })} />
      <div className="mk-themerow">
        <Field label="Accent colour">
          <div className="mk-colorrow">
            <input type="color" className="mk-colorchip" value={/^#[0-9a-fA-F]{6}$/.test(site.accent) ? site.accent : "#bd5d3a"} onChange={(e) => patch({ accent: e.target.value })} />
            <span className="bv-mono">{site.accent}</span>
          </div>
        </Field>
      </div>
      <Field label="Theme preset" hint="A starting palette. Your accent colour overrides it.">
        <div className="mk-themegrid">
          {Object.entries(THEMES as Record<string, { label: string; accent: string }>).map(([k, v]) => (
            <button
              key={k}
              type="button"
              className={`mk-themecard ${site.theme === k ? "is-active" : ""}`}
              onClick={() => patch({ theme: k, accent: v.accent })}
            >
              <span className="mk-themeswatch" style={{ background: v.accent }} />
              <span>{v.label}</span>
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

/* ───────────────────────── Products ───────────────────────── */
function ProductModal({ product, currency, onClose, onSaved }: { product: Product | null; currency: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product?.name || "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [desc, setDesc] = useState(product?.description || "");
  const [image, setImage] = useState(product?.image_url || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<{ name?: string; price?: string }>({});

  async function save() {
    if (busy) return;
    setErr(null);
    setFe({});
    if (!name.trim()) return setFe({ name: "Product name is required." });
    if (price === "" || !Number.isFinite(Number(price))) return setFe({ price: "Enter a price." });
    setBusy(true);
    try {
      const r = await postJSON("/api/products", { intent: product ? "update" : "create", id: product?.id, name, price: Number(price), description: desc, image_url: image });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.field) setFe({ [j.field]: j.message });
        else setErr(j.message || "Couldn’t save, try again.");
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={product ? "Edit product" : "Add product"} onClose={onClose}>
      <Field label="Product name" error={fe.name}><input className="bv-input" placeholder="e.g. Signature Box" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Price" error={fe.price}>
        <div className="mk-field-prefixed"><span className="mk-prefix">{currency}</span><input className="bv-input" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
      </Field>
      <Field label="Description" hint="Shown under the product name."><textarea className="bv-input" rows={2} placeholder="A short description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <ImageUpload label="Photo" value={image} onChange={setImage} />
      {err && <div className="bv-error">{err}</div>}
      <div className="mk-modal-foot">
        <button className="bv-btn" onClick={onClose}>Cancel</button>
        <button className="bv-btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : product ? "Save changes" : "Add product"}</button>
      </div>
    </Modal>
  );
}

function ImportModal({ catalog, onClose, onDone }: { catalog: CatalogItem[]; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function go() {
    if (!picked.size || busy) return;
    setBusy(true);
    try {
      await postJSON("/api/products", { intent: "import", products: catalog.filter((c) => picked.has(c.id)) });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Import from your catalog" onClose={onClose}>
      {catalog.length === 0 ? (
        <div className="bv-empty"><p className="bv-muted">Your Inkress catalog is empty.</p></div>
      ) : (
        <div className="mk-picklist">
          {catalog.map((c) => (
            <label key={c.id} className="mk-pick">
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
              {c.image ? <div className="mk-thumb" style={{ backgroundImage: `url('${c.image}')` }} /> : <div className="mk-thumb ph">{c.title.slice(0, 1)}</div>}
              <div><div>{c.title}</div><div className="bv-muted bv-sm">{money(c.price, c.currency)}</div></div>
            </label>
          ))}
        </div>
      )}
      <div className="mk-modal-foot">
        <button className="bv-btn" onClick={onClose}>Cancel</button>
        <button className="bv-btn primary" disabled={busy || !picked.size} onClick={go}>{busy ? "Importing…" : `Import ${picked.size || ""}`}</button>
      </div>
    </Modal>
  );
}

export function ProductsPanel({ products, catalog, catalogAvailable, currency, onChanged }: { products: Product[]; catalog: CatalogItem[]; catalogAvailable: boolean; currency: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Product | null | "new">(null);
  const [importing, setImporting] = useState(false);
  const refresh = () => { setEditing(null); setImporting(false); onChanged(); };
  const del = async (p: Product) => { await postJSON("/api/products", { intent: "delete", id: p.id }); onChanged(); };

  return (
    <div className="mk-panel">
      <div className="mk-panel-head">
        <div>
          <h2 className="mk-panel-title">Products</h2>
          <p className="mk-panel-sub">{products.length} item{products.length === 1 ? "" : "s"} on your storefront.</p>
        </div>
        <div className="bv-row">
          {catalogAvailable && <button className="bv-btn" onClick={() => setImporting(true)}>Import</button>}
          <button className="bv-btn primary" onClick={() => setEditing("new")}>Add product</button>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="mk-emptyblocks">No products yet. Add one, or import your existing catalog.</div>
      ) : (
        <div className="mk-prodlist">
          {products.map((p) => (
            <div key={p.id} className="mk-prodrow">
              {p.image_url ? <img src={p.image_url} className="mk-thumb lg" alt="" /> : <div className="mk-thumb lg ph">{(p.name || "?").slice(0, 1)}</div>}
              <div className="mk-prodmain">
                <div className="mk-prodname">{p.name}</div>
                {p.description && <div className="bv-muted bv-sm">{p.description.slice(0, 80)}</div>}
              </div>
              <div className="mk-prodprice tnum">{money(p.price, p.currency)}</div>
              <span className={`bv-badge ${p.active ? "ok" : ""}`}>{p.active ? "on site" : "hidden"}</span>
              <div className="bv-row">
                <button className="bv-btn sm" onClick={() => setEditing(p)}>Edit</button>
                <button className="bv-btn sm" onClick={() => del(p)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <ProductModal product={editing === "new" ? null : editing} currency={currency} onClose={() => setEditing(null)} onSaved={refresh} />}
      {importing && <ImportModal catalog={catalog} onClose={() => setImporting(false)} onDone={refresh} />}
    </div>
  );
}

/* ───────────────────────── Page (publish/handle/domains) ───────────────────────── */
export function PagePanel({
  site, publicUrl, orders, revenue, productCount, domains, onChanged, toast,
}: {
  site: SiteState;
  publicUrl: string;
  orders: number;
  revenue: number;
  productCount: number;
  domains: { id: number; domain: string; status: string }[];
  onChanged: () => void;
  toast: (a: any) => void;
}) {
  const [handle, setHandle] = useState(site.handle);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [domErr, setDomErr] = useState<string | null>(null);
  const [domInfo, setDomInfo] = useState<any>(null);

  const togglePublish = async () => { setBusy("pub"); await postJSON("/api/site", { intent: "publish", published: !site.published }); setBusy(null); onChanged(); };
  const saveHandle = async () => { setBusy("handle"); await postJSON("/api/site", { intent: "handle", handle }); setBusy(null); onChanged(); };
  const addDomain = async () => {
    setBusy("dom"); setDomErr(null); setDomInfo(null);
    const r = await postJSON("/api/domains", { intent: "add", domain });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setDomErr(j.message || "Couldn’t add that domain.");
    setDomInfo(j.instructions); setDomain(""); onChanged();
  };
  const removeDomain = async (id: number) => { await postJSON("/api/domains", { intent: "remove", id }); onChanged(); };

  return (
    <div className="mk-panel">
      <div className="mk-panel-head">
        <div>
          <h2 className="mk-panel-title">Your page</h2>
          <p className="mk-panel-sub">Address, publishing, and traffic.</p>
        </div>
        <button className={`bv-btn ${site.published ? "" : "primary"}`} disabled={busy === "pub"} onClick={togglePublish}>
          {busy === "pub" ? "…" : site.published ? "Unpublish" : "Publish site"}
        </button>
      </div>

      <div className="mk-statgrid">
        <div className="mk-stat"><span className="mk-stat-k">Status</span><span className="mk-stat-v" style={{ color: site.published ? "var(--bv-ok)" : "var(--bv-muted)" }}>{site.published ? "Live" : "Draft"}</span></div>
        <div className="mk-stat"><span className="mk-stat-k">Paid orders</span><span className="mk-stat-v">{orders}</span></div>
        <div className="mk-stat"><span className="mk-stat-k">Revenue</span><span className="mk-stat-v tnum">{money(revenue, site.currency)}</span></div>
        <div className="mk-stat"><span className="mk-stat-k">Products</span><span className="mk-stat-v">{productCount}</span></div>
      </div>

      <div className="mk-subcard">
        <div className="mk-subcard-t">Public address</div>
        <div className="bv-row" style={{ flexWrap: "wrap", gap: 8 }}>
          <a className="bv-link" href={publicUrl} target="_blank" rel="noopener">{publicUrl}</a>
          <button className="bv-btn sm" onClick={() => { navigator.clipboard?.writeText(publicUrl); toast({ kind: "success", message: "Link copied" }); }}>Copy</button>
          <a className="bv-btn sm" href={publicUrl} target="_blank" rel="noopener">View ↗</a>
        </div>
        <div className="mk-field-prefixed" style={{ marginTop: 12 }}>
          <span className="mk-prefix">…/s/</span>
          <input className="bv-input" value={handle} onChange={(e) => setHandle(e.target.value)} />
        </div>
        <button className="bv-btn primary sm" style={{ marginTop: 8 }} disabled={busy === "handle"} onClick={saveHandle}>Update address</button>
      </div>

      <div className="mk-subcard">
        <div className="mk-subcard-t">Custom domain</div>
        <p className="bv-muted bv-sm">Use your own web address instead of the Inkress link.</p>
        {domains.length > 0 && (
          <div style={{ margin: "8px 0" }}>
            {domains.map((d) => (
              <div key={d.id} className="bv-row" style={{ justifyContent: "space-between", padding: "6px 0" }}>
                <span className="bv-mono">{d.domain} <span className={`bv-badge ${d.status === "active" ? "ok" : ""}`}>{d.status}</span></span>
                <button className="bv-btn sm" onClick={() => removeDomain(d.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div className="bv-row">
          <input className="bv-input" placeholder="shop.yourbrand.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <button className="bv-btn" disabled={busy === "dom"} onClick={addDomain}>Add</button>
        </div>
        {domErr && <div className="bv-error">{domErr}</div>}
        {domInfo && (
          <div className="bv-success" style={{ marginTop: 10 }}>
            <b>Added — now point your DNS</b>
            <div className="bv-mono">A · {domInfo.a_record?.host} · {domInfo.a_record?.value}</div>
            <p className="bv-muted bv-sm">{domInfo.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Settings (layout toggle) ───────────────────────── */
export function SettingsPanel({ layout, onLayout }: { layout: "studio" | "sidebar"; onLayout: (l: "studio" | "sidebar") => void }) {
  const [busy, setBusy] = useState(false);
  const pick = async (l: "studio" | "sidebar") => {
    if (l === layout || busy) return;
    onLayout(l); // instant switch
    setBusy(true);
    await postJSON("/api/site", { intent: "layout", layout: l }).catch(() => {});
    setBusy(false);
  };
  return (
    <div className="mk-panel">
      <div className="mk-panel-head">
        <div>
          <h2 className="mk-panel-title">Settings</h2>
          <p className="mk-panel-sub">How your editor looks and works.</p>
        </div>
      </div>
      <Field label="Editor layout" hint="Switch how the builder is arranged. Takes effect instantly.">
        <div className="mk-layoutpick">
          <button type="button" className={`mk-layoutcard ${layout === "studio" ? "is-active" : ""}`} onClick={() => pick("studio")}>
            <span className="mk-layoutart studio" aria-hidden>
              <span className="r" /><span className="m" /><span className="p" />
            </span>
            <span className="mk-layoutname">Studio</span>
            <span className="mk-layoutdesc">Live preview front and centre, controls beside it.</span>
          </button>
          <button type="button" className={`mk-layoutcard ${layout === "sidebar" ? "is-active" : ""}`} onClick={() => pick("sidebar")}>
            <span className="mk-layoutart sidebar" aria-hidden>
              <span className="s" /><span className="b" />
            </span>
            <span className="mk-layoutname">Sidebar</span>
            <span className="mk-layoutdesc">A classic admin: nav on the left, full-width panels.</span>
          </button>
        </div>
      </Field>
    </div>
  );
}
