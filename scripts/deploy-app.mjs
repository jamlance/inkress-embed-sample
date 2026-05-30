#!/usr/bin/env node
/**
 * Configure a Coolify clone for one of our apps + trigger a deploy.
 *
 *   node scripts/deploy-app.mjs \
 *     --clone-uuid <uuid> \
 *     --name bookerva-currency-dashboard \
 *     --git-repo https://github.com/jamlance/bookerva-apps.git \
 *     --git-branch main \
 *     --base-dir /apps/currency-dashboard \
 *     --dockerfile Dockerfile \
 *     --env "OAUTH_CLIENT_ID=...,OAUTH_CLIENT_SECRET=...,..."
 *
 * Renames the Coolify app, repoints its git source, sets env vars,
 * and triggers a deploy. Returns the deployment uuid for polling.
 */

import fs from "node:fs";
import path from "node:path";

const COOLIFY_ENV = fs
  .readFileSync("/Users/romario/projects/inkress/.env.coolify", "utf8")
  .split("\n")
  .reduce((acc, line) => {
    const [k, ...vs] = line.split("=");
    if (k && vs.length) acc[k.trim()] = vs.join("=").trim();
    return acc;
  }, {});

const BASE = COOLIFY_ENV.COOLIFY_BASE_URL;
const TOKEN = COOLIFY_ENV.COOLIFY_API_TOKEN;

if (!BASE || !TOKEN) {
  console.error("Missing COOLIFY_BASE_URL / COOLIFY_API_TOKEN in .env.coolify");
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k?.startsWith("--")) continue;
    const key = k.replace(/^--/, "");
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

async function coolify(path, init = {}) {
  const r = await fetch(`${BASE}api/v1${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!r.ok) {
    throw new Error(`coolify ${init.method || "GET"} ${path} ${r.status}: ${text.slice(0, 200)}`);
  }
  return body;
}

async function main() {
  const args = parseArgs(process.argv);
  const required = ["clone-uuid", "name", "git-repo", "git-branch", "base-dir"];
  const missing = required.filter((k) => !args[k]);
  if (missing.length) {
    console.error("Missing:", missing.join(", "));
    process.exit(2);
  }

  const uuid = args["clone-uuid"];
  const name = args.name;
  const dockerfileLocation = args.dockerfile || "Dockerfile";
  const envCsv = args.env || "";

  // 1. Update name + git source + build config
  await coolify(`/applications/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify({
      name,
      git_repository: args["git-repo"],
      git_branch: args["git-branch"],
      git_commit_sha: "HEAD",
      base_directory: args["base-dir"],
      dockerfile_location: dockerfileLocation,
      build_pack: "dockerfile",
      ports_exposes: "3000",
    }),
  });
  console.error(`[${name}] config updated`);

  // 2. Env vars
  if (envCsv) {
    const pairs = envCsv.split(",").map((p) => {
      const [k, ...vs] = p.split("=");
      return { key: k.trim(), value: vs.join("=").trim() };
    });
    for (const { key, value } of pairs) {
      if (!key) continue;
      try {
        await coolify(`/applications/${uuid}/envs`, {
          method: "POST",
          body: JSON.stringify({
            key,
            value,
            is_build_time: false,
            is_preview: false,
            is_literal: true,
          }),
        });
      } catch (err) {
        // PATCH if it already exists
        try {
          await coolify(`/applications/${uuid}/envs`, {
            method: "PATCH",
            body: JSON.stringify({
              key,
              value,
              is_build_time: false,
              is_preview: false,
              is_literal: true,
            }),
          });
        } catch (err2) {
          console.error(`  env ${key}: failed (${err2.message})`);
        }
      }
    }
    console.error(`[${name}] ${pairs.length} env vars set`);
  }

  // 3. Trigger deploy
  const dep = await coolify(`/deploy?uuid=${uuid}`);
  console.log(
    JSON.stringify({
      uuid,
      name,
      deployment_uuid: dep?.deployments?.[0]?.deployment_uuid,
      fqdn: args["fqdn"] || null,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
