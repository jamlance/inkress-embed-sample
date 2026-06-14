import { useRef, useState } from "react";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
const MAX_BYTES = 5 * 1024 * 1024;

/** Real upload control: click OR drag-drop, client type/size validation, live
 *  preview, Replace/Remove, with a collapsed paste-URL fallback. Posts the data
 *  URL to /api/upload (S3) and calls onChange with the hosted URL. */
export function ImageUpload({
  value,
  onChange,
  label,
  compact,
}: {
  value?: string | null;
  onChange: (url: string) => void;
  label?: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handle(file?: File) {
    if (!file) return;
    setErr(null);
    if (!IMAGE_TYPES.includes(file.type)) return setErr("Use a JPG, PNG, WEBP, GIF or SVG image.");
    if (file.size > MAX_BYTES) return setErr("Image must be under 5 MB.");
    setBusy(true);
    try {
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error("Couldn’t read that file."));
        r.readAsDataURL(file);
      });
      const r = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(j.message || "Upload failed — try again.");
      onChange(j.url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mk-field">
      {label && <label className="bv-label">{label}</label>}
      <div
        className={`mk-drop ${over ? "over" : ""} ${compact ? "compact" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handle(e.dataTransfer.files?.[0]);
        }}
      >
        {value ? (
          <img src={value} className="mk-drop-prev" alt="" />
        ) : (
          <div className="bv-muted bv-sm" style={{ textAlign: "center" }}>
            Drag an image here, or click to upload
            <br />
            <span style={{ fontSize: "0.7rem", opacity: 0.7 }}>JPG, PNG, WEBP, GIF, SVG · up to 5 MB</span>
          </div>
        )}
        {busy && (
          <div className="mk-drop-busy">
            <span className="bv-spin" /> Uploading…
          </div>
        )}
        {value && !busy && (
          <div className="mk-drop-actions">
            <button type="button" className="bv-btn sm" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Replace</button>
            <button type="button" className="bv-btn sm" onClick={(e) => { e.stopPropagation(); onChange(""); setErr(null); }}>Remove</button>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        style={{ display: "none" }}
        onChange={(e) => {
          handle(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {err && <div className="bv-error">{err}</div>}
      <details className="mk-urlalt">
        <summary className="bv-muted bv-sm">or paste a URL</summary>
        <input
          className="bv-input"
          defaultValue={value || ""}
          placeholder="https://…"
          onChange={(e) => onChange(e.target.value)}
          style={{ marginTop: 6 }}
        />
      </details>
    </div>
  );
}
