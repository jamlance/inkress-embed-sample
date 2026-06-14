// The two editor shells. Both consume the SAME panels + live preview; they only
// differ in how they arrange them. The merchant switches between them in Settings.
import type { ReactNode } from "react";

export type PanelKey = "build" | "products" | "theme" | "page" | "settings";

export const PANELS: { key: PanelKey; label: string; glyph: string }[] = [
  { key: "build", label: "Build", glyph: "◫" },
  { key: "products", label: "Products", glyph: "❏" },
  { key: "theme", label: "Theme", glyph: "◐" },
  { key: "page", label: "Page", glyph: "⬡" },
  { key: "settings", label: "Settings", glyph: "⚙" },
];

const initials = (s?: string) =>
  String(s || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export type ShellProps = {
  brand: { name: string; logo: string; accent: string };
  handle: string;
  published: boolean;
  publicUrl: string;
  panel: PanelKey;
  setPanel: (k: PanelKey) => void;
  panelNode: ReactNode;
  preview: ReactNode;
  onPublish: () => void;
  publishing: boolean;
};

function BrandMark({ name, logo, accent }: { name: string; logo: string; accent: string }) {
  return logo ? (
    <img className="mk-brandmark" src={logo} alt="" />
  ) : (
    <span className="mk-brandmark ph" style={{ background: `color-mix(in oklch, ${accent} 18%, var(--bv-surface))`, color: accent }}>
      {initials(name)}
    </span>
  );
}

function PreviewFrame({ handle, publicUrl, children }: { handle: string; publicUrl: string; children: ReactNode }) {
  return (
    <div className="mk-device">
      <div className="mk-device-bar">
        <span className="mk-device-dots"><i /><i /><i /></span>
        <span className="mk-device-url">{publicUrl.replace(/^https?:\/\//, "").replace(/\/s\//, " / ")}</span>
        <a className="mk-device-open" href={publicUrl} target="_blank" rel="noopener" title="Open in a new tab">↗</a>
      </div>
      <div className="mk-device-screen">{children}</div>
    </div>
  );
}

function PublishButton({ published, onPublish, publishing }: { published: boolean; onPublish: () => void; publishing: boolean }) {
  return (
    <button className={`bv-btn ${published ? "" : "primary"}`} onClick={onPublish} disabled={publishing}>
      {publishing ? "…" : published ? <>● Live</> : "Publish"}
    </button>
  );
}

/* ───────────────────────── Studio: preview-first ───────────────────────── */
export function ShellStudio(p: ShellProps) {
  return (
    <div className="mk-studio">
      <header className="mk-studio-top">
        <div className="mk-studio-brand">
          <BrandMark {...p.brand} />
          <div>
            <div className="mk-studio-name">{p.brand.name || "Your storefront"}</div>
            <div className="mk-studio-handle">/s/{p.handle}</div>
          </div>
        </div>
        <div className="mk-studio-actions">
          <a className="bv-btn sm" href={p.publicUrl} target="_blank" rel="noopener">View ↗</a>
          <PublishButton published={p.published} onPublish={p.onPublish} publishing={p.publishing} />
        </div>
      </header>

      <div className="mk-studio-body">
        <nav className="mk-rail" aria-label="Editor sections">
          {PANELS.map((t) => (
            <button key={t.key} className={`mk-rail-btn ${p.panel === t.key ? "is-active" : ""}`} onClick={() => p.setPanel(t.key)} aria-current={p.panel === t.key}>
              <span className="mk-rail-glyph" aria-hidden>{t.glyph}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <section className="mk-studio-controls">{p.panelNode}</section>

        <section className="mk-studio-preview">
          <div className="mk-preview-label">Live preview</div>
          <PreviewFrame handle={p.handle} publicUrl={p.publicUrl}>{p.preview}</PreviewFrame>
        </section>
      </div>
    </div>
  );
}

/* ───────────────────────── Sidebar: admin workspace ───────────────────────── */
export function ShellSidebar(p: ShellProps) {
  const withPreview = p.panel === "build" || p.panel === "theme";
  return (
    <div className="mk-side">
      <aside className="mk-side-nav">
        <div className="mk-side-brand">
          <BrandMark {...p.brand} />
          <div className="mk-side-brandtext">
            <div className="mk-side-name">{p.brand.name || "Your storefront"}</div>
            <div className={`mk-side-status ${p.published ? "live" : ""}`}>{p.published ? "● Live" : "○ Draft"}</div>
          </div>
        </div>
        <nav className="mk-side-list" aria-label="Editor sections">
          {PANELS.map((t) => (
            <button key={t.key} className={`mk-side-item ${p.panel === t.key ? "is-active" : ""}`} onClick={() => p.setPanel(t.key)} aria-current={p.panel === t.key}>
              <span className="mk-side-glyph" aria-hidden>{t.glyph}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="mk-side-foot">
          <a className="bv-btn sm" href={p.publicUrl} target="_blank" rel="noopener">View site ↗</a>
          <PublishButton published={p.published} onPublish={p.onPublish} publishing={p.publishing} />
        </div>
      </aside>

      <main className={`mk-side-main ${withPreview ? "split" : ""}`}>
        <div className="mk-side-panel">{p.panelNode}</div>
        {withPreview && (
          <div className="mk-side-previewcol">
            <div className="mk-preview-label">Live preview</div>
            <PreviewFrame handle={p.handle} publicUrl={p.publicUrl}>{p.preview}</PreviewFrame>
          </div>
        )}
      </main>
    </div>
  );
}
