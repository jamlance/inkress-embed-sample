import type { ReactNode } from "react";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="mk-modal-backdrop" onClick={onClose}>
      <div className="mk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mk-modal-head">
          <b>{title}</b>
          <button className="mk-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="mk-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, error, hint, children }: { label?: string; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <div className="mk-field">
      {label && <label className="bv-label">{label}</label>}
      {children}
      {error && <div className="bv-error">{error}</div>}
      {hint && !error && <div className="bv-muted bv-sm" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
