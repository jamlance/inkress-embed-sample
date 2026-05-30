#!/usr/bin/env node
/**
 * Generate/refresh a per-app DEPLOY repo from this monorepo.
 *
 *   node scripts/sync-app-repo.mjs <app-name> [--private] [--push]
 *
 * The monorepo stays the single source of truth (core + design system live
 * here). This script bundles ONE app + a fresh copy of `packages/core` + the
 * minimal workspace root into a self-contained repo `jamlance/bookerva-<app>`,
 * which Coolify deploys with the app's existing Dockerfile (base_dir=/,
 * dockerfile=/apps/<app>/Dockerfile). Re-run after changing the app or core.
 *
 * Without --push it just stages the tree (dry run). With --push it creates the
 * GitHub repo if needed and force-pushes `main` (the repo is a generated
 * mirror; history is intentionally disposable).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONO = path.resolve(__dirname, "..");
const ORG = "jamlance";

const app = process.argv[2];
const PUSH = process.argv.includes("--push");
const PRIVATE = process.argv.includes("--private");
if (!app) { console.error("usage: sync-app-repo.mjs <app-name> [--private] [--push]"); process.exit(2); }

const appDir = path.join(MONO, "apps", app);
if (!fs.existsSync(appDir)) { console.error(`no such app: apps/${app}`); process.exit(1); }

const repo = `bookerva-${app}`;
const stage = path.join("/tmp/bv-deploy", repo);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts }).trim();

// 1) clean staging tree
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

const copyFilter = (src) => !/(\/node_modules|\/dist|\/\.git|\.tsbuildinfo|\.DS_Store)/.test(src);
fs.cpSync(path.join(MONO, "packages", "core"), path.join(stage, "packages", "core"), { recursive: true, filter: copyFilter });
fs.cpSync(appDir, path.join(stage, "apps", app), { recursive: true, filter: copyFilter });

// 2) minimal workspace root + meta
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({
  name: repo, version: "0.1.0", private: true,
  description: `Inkress-embedded app: ${app} (generated from jamlance/bookerva-apps).`,
  packageManager: "pnpm@9.0.0", engines: { node: ">=20" },
  dependencies: { pg: "^8.21.0" },
}, null, 2) + "\n");
fs.writeFileSync(path.join(stage, "pnpm-workspace.yaml"), `packages:\n  - "packages/*"\n  - "apps/*"\n`);
fs.writeFileSync(path.join(stage, ".gitignore"), ["node_modules", "dist", "*.log", ".DS_Store", ".env*", "!.env.example", "*.tsbuildinfo"].join("\n") + "\n");
fs.writeFileSync(path.join(stage, "README.md"), `# ${repo}\n\nDeploy repo for the **${app}** Inkress-embedded app. Generated from \`jamlance/bookerva-apps\` — edit there, then re-run \`scripts/sync-app-repo.mjs ${app} --push\`.\n\nCoolify: base_directory \`/\`, dockerfile \`/apps/${app}/Dockerfile\`.\n`);

console.log(`staged ${repo} at ${stage}`);
if (!PUSH) { console.log("(dry run — pass --push to create/refresh the GitHub repo)"); process.exit(0); }

// 3) ensure repo exists
let exists = true;
try { sh("gh", ["repo", "view", `${ORG}/${repo}`]); } catch { exists = false; }
if (!exists) {
  sh("gh", ["repo", "create", `${ORG}/${repo}`, PRIVATE ? "--private" : "--public", "--description", `Inkress-embedded app: ${app}`]);
  console.log(`created ${ORG}/${repo}`);
}

// 4) commit + force-push main
const git = (args) => sh("git", args, { cwd: stage });
git(["init", "-b", "main"]);
git(["add", "-A"]);
git(["-c", "user.email=apps@bookerva.com", "-c", "user.name=bookerva-apps sync", "commit", "-q", "-m", `sync ${app} from monorepo`]);
git(["remote", "add", "origin", `https://github.com/${ORG}/${repo}.git`]);
git(["push", "-f", "origin", "main"]);
console.log(`pushed → https://github.com/${ORG}/${repo}`);
