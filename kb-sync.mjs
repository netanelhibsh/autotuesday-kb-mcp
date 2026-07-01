// kb-sync: pull the KB items you're allowed to see (RLS) into a local mirror.
// The mirror is a CACHE — Supabase is the source of truth. Read here; write via the MCP.
// Reuses the MCP's persisted session (~/.autotuesday-kb-session.json), so no extra login.
//
// Usage:  node kb-sync.mjs
// Env:    AT_KB_SUPABASE_URL, AT_KB_SUPABASE_ANON_KEY  (required)
//         AT_KB_CACHE_DIR  (default ~/autotuesday-kb)
//         optional first-run auth: AT_KB_EMAIL+AT_KB_PASSWORD or AT_KB_REFRESH_TOKEN
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL = process.env.AT_KB_SUPABASE_URL;
const ANON = process.env.AT_KB_SUPABASE_ANON_KEY;
const CACHE = process.env.AT_KB_CACHE_DIR || path.join(os.homedir(), "autotuesday-kb");
if (!URL || !ANON) { console.error("[kb-sync] missing AT_KB_SUPABASE_URL / AT_KB_SUPABASE_ANON_KEY"); process.exit(1); }

const SESSION_FILE = process.env.AT_KB_SESSION_FILE || path.join(os.homedir(), ".autotuesday-kb-session.json");
const fileStorage = {
  getItem(k) { try { return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"))[k] ?? null; } catch { return null; } },
  setItem(k, v) { let j = {}; try { j = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); } catch { /* */ } j[k] = v; fs.writeFileSync(SESSION_FILE, JSON.stringify(j), { mode: 0o600 }); },
  removeItem(k) { try { const j = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); delete j[k]; fs.writeFileSync(SESSION_FILE, JSON.stringify(j), { mode: 0o600 }); } catch { /* */ } },
};
const sb = createClient(URL, ANON, { auth: { persistSession: true, autoRefreshToken: true, storage: fileStorage, storageKey: "at-kb" } });

async function ensureAuth() {
  const { data } = await sb.auth.getSession();
  if (data.session) return;
  if (process.env.AT_KB_EMAIL && process.env.AT_KB_PASSWORD) {
    const { error } = await sb.auth.signInWithPassword({ email: process.env.AT_KB_EMAIL, password: process.env.AT_KB_PASSWORD });
    if (error) { console.error("[kb-sync] password auth failed:", error.message); process.exit(1); }
  } else if (process.env.AT_KB_REFRESH_TOKEN) {
    const { error } = await sb.auth.refreshSession({ refresh_token: process.env.AT_KB_REFRESH_TOKEN });
    if (error) { console.error("[kb-sync] refresh bootstrap failed:", error.message); process.exit(1); }
  } else {
    console.error("[kb-sync] no session found. Connect the MCP first, or set AT_KB_EMAIL+AT_KB_PASSWORD.");
    process.exit(1);
  }
}

const slug = (s) => (s || "item").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";

function targetPath(item) {
  if (item.source_path) return path.join(CACHE, item.source_path);
  const bucket = item.visibility === "private" ? "_private" : item.workspace_slug || "_org";
  return path.join(CACHE, "_kb", bucket, `${slug(item.title)}-${item.id.slice(0, 8)}.md`);
}

async function main() {
  await ensureAuth();
  // workspace slugs for nice foldering of file-less items
  const { data: ws } = await sb.from("workspaces").select("id, slug");
  const wsSlug = Object.fromEntries((ws || []).map((w) => [w.id, w.slug]));

  const { data: items, error } = await sb.from("kb_items").select("id, source_path, workspace_id, title, body, kind, visibility, version, updated_at");
  if (error) { console.error("[kb-sync] fetch failed:", error.message); process.exit(1); }

  fs.mkdirSync(CACHE, { recursive: true });
  const written = new Set();
  for (const it of items) {
    it.workspace_slug = it.workspace_id ? wsSlug[it.workspace_id] : null;
    const p = targetPath(it);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, it.body ?? "");
    written.add(path.resolve(p));
  }

  // prune stale cache files (things you can no longer see / were deleted)
  let pruned = 0;
  const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith(".md") && !written.has(path.resolve(f))) { fs.rmSync(f); pruned++; }
  } };
  walk(CACHE);

  console.log(`[kb-sync] ${written.size} items -> ${CACHE}  (pruned ${pruned} stale)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
