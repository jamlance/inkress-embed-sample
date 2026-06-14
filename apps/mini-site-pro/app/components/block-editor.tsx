import type { ReactNode } from "react";
import { BLOCK_META } from "~/lib/blocks.mjs";
import { ImageUpload } from "./image-upload";

type Data = Record<string, any>;
type Block = { id: string; type: string; data: Data };

function Field({ label, children, hint }: { label?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mk-field">
      {label && <label className="bv-label">{label}</label>}
      {children}
      {hint && <div className="bv-muted bv-sm" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function ArrayEditor({
  value,
  onChange,
  cols,
  addLabel,
}: {
  value: Data[];
  onChange: (v: Data[]) => void;
  cols: { key: string; ph: string }[];
  addLabel: string;
}) {
  const items = Array.isArray(value) ? value : [];
  const upd = (i: number, k: string, v: string) => {
    const n = items.slice();
    n[i] = { ...n[i], [k]: v };
    onChange(n);
  };
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="mk-arrrow">
          {cols.map((c) => (
            <input key={c.key} className="bv-input" placeholder={c.ph} value={it[c.key] || ""} onChange={(e) => upd(i, c.key, e.target.value)} />
          ))}
          <button type="button" className="bv-btn sm" aria-label="Remove row" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="bv-btn sm" onClick={() => onChange([...items, {}])}>+ {addLabel}</button>
    </div>
  );
}

function Gallery({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const images = Array.isArray(value) ? value : [];
  return (
    <div>
      <div className="mk-gallery">
        {images.map((u, i) => (
          <div key={i} className="mk-gtile" style={{ backgroundImage: `url('${u}')` }}>
            <button type="button" className="mk-gx" aria-label="Remove image" onClick={() => onChange(images.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <ImageUpload compact label="" onChange={(url) => url && onChange([...images, url])} />
    </div>
  );
}

export function BlockEditor({ block, onChange, onClose }: { block: Block; onChange: (data: Data) => void; onClose: () => void }) {
  const d = block.data || {};
  const set = (patch: Data) => onChange({ ...d, ...patch });
  const meta = (BLOCK_META as Record<string, { label: string }>)[block.type];

  return (
    <div className="mk-modal-backdrop" onClick={onClose}>
      <div className="mk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Edit ${meta?.label}`}>
        <div className="mk-modal-head">
          <b>Edit {meta?.label || block.type}</b>
          <button className="mk-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="mk-modal-body">
          {block.type === "hero" && (
            <>
              <Field label="Headline" hint="Blank = your business name"><input className="bv-input" value={d.title || ""} onChange={(e) => set({ title: e.target.value })} /></Field>
              <Field label="Subtitle" hint="Blank = your tagline"><input className="bv-input" value={d.subtitle || ""} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
              <ImageUpload label="Background image" value={d.image} onChange={(url) => set({ image: url })} />
              <Field label="Button label"><input className="bv-input" placeholder="Shop now" value={d.cta_label || ""} onChange={(e) => set({ cta_label: e.target.value })} /></Field>
              <Field label="Button links to">
                <select className="bv-input" value={d.cta_target || "products"} onChange={(e) => set({ cta_target: e.target.value })}>
                  <option value="products">Products</option>
                  <option value="contact">Contact</option>
                  <option value="link">First link</option>
                </select>
              </Field>
            </>
          )}
          {block.type === "products" && (
            <Field label="Heading"><input className="bv-input" placeholder="Shop" value={d.heading || ""} onChange={(e) => set({ heading: e.target.value })} /></Field>
          )}
          {block.type === "text" && (
            <>
              <Field label="Heading"><input className="bv-input" value={d.heading || ""} onChange={(e) => set({ heading: e.target.value })} /></Field>
              <Field label="Body"><textarea className="bv-input" rows={5} placeholder="Tell customers about your business…" value={d.body || ""} onChange={(e) => set({ body: e.target.value })} /></Field>
            </>
          )}
          {block.type === "gallery" && (
            <>
              <Field label="Heading"><input className="bv-input" value={d.heading || ""} onChange={(e) => set({ heading: e.target.value })} /></Field>
              <Field label="Images"><Gallery value={d.images} onChange={(images) => set({ images })} /></Field>
            </>
          )}
          {block.type === "links" && (
            <>
              <Field label="Heading"><input className="bv-input" value={d.heading || ""} onChange={(e) => set({ heading: e.target.value })} /></Field>
              <Field label="Links"><ArrayEditor value={d.links} onChange={(links) => set({ links })} cols={[{ key: "label", ph: "Label (e.g. Instagram)" }, { key: "url", ph: "instagram.com/you" }]} addLabel="Add link" /></Field>
            </>
          )}
          {block.type === "contact" && (
            <>
              <Field label="Heading"><input className="bv-input" value={d.heading || ""} onChange={(e) => set({ heading: e.target.value })} /></Field>
              <Field label="Phone"><input className="bv-input" value={d.phone || ""} onChange={(e) => set({ phone: e.target.value })} /></Field>
              <Field label="Email"><input className="bv-input" value={d.email || ""} onChange={(e) => set({ email: e.target.value })} /></Field>
              <Field label="Address"><input className="bv-input" value={d.address || ""} onChange={(e) => set({ address: e.target.value })} /></Field>
            </>
          )}
          {block.type === "hours" && (
            <>
              <Field label="Heading"><input className="bv-input" value={d.heading || ""} onChange={(e) => set({ heading: e.target.value })} /></Field>
              <Field label="Rows"><ArrayEditor value={d.rows} onChange={(rows) => set({ rows })} cols={[{ key: "label", ph: "Mon–Fri" }, { key: "value", ph: "9am – 5pm" }]} addLabel="Add row" /></Field>
            </>
          )}
          {block.type === "testimonials" && (
            <>
              <Field label="Heading"><input className="bv-input" value={d.heading || ""} onChange={(e) => set({ heading: e.target.value })} /></Field>
              <Field label="Quotes"><ArrayEditor value={d.items} onChange={(items) => set({ items })} cols={[{ key: "quote", ph: "Great service!" }, { key: "author", ph: "Customer name" }]} addLabel="Add quote" /></Field>
            </>
          )}
        </div>
        <div className="mk-modal-foot">
          <button className="bv-btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
