import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@bookerva-apps/core";
import { openDb } from "@bookerva-apps/core/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[document-vault] Missing env: ${k}`); process.exit(1); }
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILES_DIR = path.join(DATA_DIR, "files");
fs.mkdirSync(FILES_DIR, { recursive: true });

const db = openDb("document-vault", `
  CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id INTEGER NOT NULL,
    label TEXT NOT NULL, attached_to TEXT, attached_id TEXT,
    filename TEXT NOT NULL, stored_name TEXT NOT NULL, content_type TEXT,
    size INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

app.get("/api/docs", core.requireSession, (req, res) => {
  const docs = db.prepare(`SELECT id, label, attached_to, attached_id, filename, content_type, size, created_at
    FROM docs WHERE merchant_id = ? ORDER BY created_at DESC`).all(req.session.merchantId);
  res.json({ docs, stats: {
    documents: docs.length,
    total_size: docs.reduce((s, d) => s + d.size, 0),
  }});
});

// Upload — base64 JSON body to avoid a multipart dep. Capped at ~8MB.
app.post("/api/docs", core.requireSession, express.json({ limit: "12mb" }), (req, res) => {
  const b = req.body || {};
  const label = String(b.label || "").trim();
  const filename = String(b.filename || "file").trim();
  const dataB64 = String(b.data_base64 || "");
  if (!label) return res.status(400).json({ error: "no_label", message: "Give the document a label." });
  if (!dataB64) return res.status(400).json({ error: "no_file", message: "Attach a file." });
  let buf;
  try { buf = Buffer.from(dataB64.replace(/^data:[^;]+;base64,/, ""), "base64"); }
  catch { return res.status(400).json({ error: "bad_data" }); }
  if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: "too_large", message: "Max 8MB per file." });
  const storedName = `${req.session.merchantId}_${crypto.randomBytes(8).toString("hex")}_${filename}`.replace(/[^\w.\-]/g, "_");
  fs.writeFileSync(path.join(FILES_DIR, storedName), buf);
  const info = db.prepare(`INSERT INTO docs (merchant_id, label, attached_to, attached_id, filename, stored_name, content_type, size)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(req.session.merchantId, label, b.attached_to || null, b.attached_id || null, filename, storedName, b.content_type || null, buf.length);
  res.json({ id: info.lastInsertRowid });
});

app.get("/api/docs/:id/download", core.requireSession, (req, res) => {
  const doc = db.prepare(`SELECT * FROM docs WHERE id = ? AND merchant_id = ?`).get(req.params.id, req.session.merchantId);
  if (!doc) return res.status(404).json({ error: "not_found" });
  const p = path.join(FILES_DIR, doc.stored_name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "file_missing" });
  res.setHeader("Content-Type", doc.content_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${doc.filename.replace(/"/g, "")}"`);
  fs.createReadStream(p).pipe(res);
});

app.delete("/api/docs/:id", core.requireSession, (req, res) => {
  const doc = db.prepare(`SELECT * FROM docs WHERE id = ? AND merchant_id = ?`).get(req.params.id, req.session.merchantId);
  if (!doc) return res.json({ ok: false });
  try { fs.unlinkSync(path.join(FILES_DIR, doc.stored_name)); } catch { /* already gone */ }
  db.prepare(`DELETE FROM docs WHERE id = ?`).run(doc.id);
  res.json({ ok: true });
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[document-vault] listening on ${HOST}:${PORT}`));
