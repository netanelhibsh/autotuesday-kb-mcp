/**
 * autotuesday-kb-mcp
 * -------------------
 * MCP server that each partner runs on their own machine. It is ONLY a pipe:
 * it signs in once with the partner's identity and carries that identity (JWT)
 * to Supabase on every call. The permission decision (who sees what / private)
 * is made by Supabase RLS — never here. A bug in this file cannot leak another
 * person's private rows, because the database itself filters them out.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL = process.env.AT_KB_SUPABASE_URL;
const ANON = process.env.AT_KB_SUPABASE_ANON_KEY;
const EMAIL = process.env.AT_KB_EMAIL;
const PASSWORD = process.env.AT_KB_PASSWORD;
const REFRESH = process.env.AT_KB_REFRESH_TOKEN;

function die(msg: string): never {
  console.error(`[autotuesday-kb-mcp] ${msg}`);
  process.exit(1);
}

if (!URL || !ANON) die("missing AT_KB_SUPABASE_URL / AT_KB_SUPABASE_ANON_KEY");

// Persistent, independent session stored in a local file (chmod 600). After the
// first sign-in the MCP owns its OWN session lineage and auto-refreshes it — it
// does NOT share/rotate the browser's token, so there's no conflict with the
// portal session. (That was the bug in the refresh-token-from-browser approach.)
const SESSION_FILE = process.env.AT_KB_SESSION_FILE || path.join(os.homedir(), ".autotuesday-kb-session.json");
const fileStorage = {
  getItem(key: string): string | null {
    try {
      const j = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
      return j[key] ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    let j: Record<string, string> = {};
    try {
      j = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    } catch {
      /* first write */
    }
    j[key] = value;
    fs.writeFileSync(SESSION_FILE, JSON.stringify(j), { mode: 0o600 });
  },
  removeItem(key: string): void {
    try {
      const j = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
      delete j[key];
      fs.writeFileSync(SESSION_FILE, JSON.stringify(j), { mode: 0o600 });
    } catch {
      /* nothing to remove */
    }
  },
};

const sb: SupabaseClient = createClient(URL, ANON, {
  auth: { persistSession: true, autoRefreshToken: true, storage: fileStorage, storageKey: "at-kb" },
});

let personId: string | null = null;
let personLabel = "unknown";

/**
 * Sign in as the partner so every query runs under their JWT (RLS applies).
 * Order: (1) reuse a persisted session if present; (2) email+password — the
 * recommended path, creates an INDEPENDENT session; (3) refresh-token — one-time
 * bootstrap only (rotates, can clash with the browser — prefer password).
 */
async function ensureAuth(): Promise<void> {
  const existing = await sb.auth.getSession();
  if (existing.data.session) {
    // persisted session found — autoRefresh keeps it alive
  } else if (EMAIL && PASSWORD) {
    const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) die(`password auth failed: ${error.message}`);
  } else if (REFRESH) {
    const { error } = await sb.auth.refreshSession({ refresh_token: REFRESH });
    if (error) die(`refresh-token bootstrap failed (token may have rotated — prefer AT_KB_EMAIL+AT_KB_PASSWORD): ${error.message}`);
  } else {
    die("no auth configured: set AT_KB_EMAIL + AT_KB_PASSWORD (recommended), or AT_KB_REFRESH_TOKEN");
  }
  // resolve which person this identity maps to (same people row as the portal)
  const { data, error } = await sb
    .from("people")
    .select("id, first_name, last_name, role")
    .limit(1)
    .maybeSingle();
  if (error) die(`could not resolve person: ${error.message}`);
  if (!data) die("authenticated, but no matching people row (auth_user_id not linked)");
  personId = data.id;
  personLabel = `${data.first_name ?? ""} ${data.last_name ?? ""} (${data.role})`.trim();
  console.error(`[autotuesday-kb-mcp] signed in as ${personLabel}`);
}

const ok = (obj: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: `ERROR: ${msg}` }], isError: true });

const server = new McpServer({ name: "autotuesday-kb", version: "0.1.0" });

// who am I (sanity / identity check)
server.tool(
  "whoami",
  "Return the person this connection is authenticated as (id, name, org role).",
  {},
  async () => ok({ person_id: personId, label: personLabel }),
);

// search KB (RLS scopes results to what you may see)
server.tool(
  "kb_search",
  "Search the knowledge base by text (title + body). Returns only items you are allowed to see.",
  { query: z.string().describe("search text"), limit: z.number().int().min(1).max(50).default(20) },
  async ({ query, limit }) => {
    const q = query.replace(/[%,]/g, " ");
    const { data, error } = await sb
      .from("kb_items")
      .select("id, kind, title, visibility, workspace_id, version, updated_at")
      .or(`title.ilike.%${q}%,body.ilike.%${q}%`)
      .order("updated_at", { ascending: false })
      .limit(limit);
    return error ? fail(error.message) : ok(data);
  },
);

// list KB items, optionally filtered
server.tool(
  "kb_list",
  "List knowledge-base items (only those you may see). Optionally filter by workspace, kind or visibility.",
  {
    workspace_id: z.string().uuid().optional(),
    kind: z.enum(["brain", "status", "decision", "ticket", "note", "doc"]).optional(),
    visibility: z.enum(["org", "workspace", "private"]).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  },
  async ({ workspace_id, kind, visibility, limit }) => {
    let qb = sb
      .from("kb_items")
      .select("id, kind, title, visibility, workspace_id, owner_id, version, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (workspace_id) qb = qb.eq("workspace_id", workspace_id);
    if (kind) qb = qb.eq("kind", kind);
    if (visibility) qb = qb.eq("visibility", visibility);
    const { data, error } = await qb;
    return error ? fail(error.message) : ok(data);
  },
);

// read one item
server.tool(
  "kb_read",
  "Read a single knowledge-base item by id (full body). Fails if you may not see it.",
  { id: z.string().uuid() },
  async ({ id }) => {
    const { data, error } = await sb.from("kb_items").select("*").eq("id", id).maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("not found or not visible to you");
    return ok(data);
  },
);

// create or update an item (RLS decides if you may write)
server.tool(
  "kb_write",
  "Create a new KB item (omit id) or update an existing one (give id + the fields to change). " +
    "visibility: org (everyone) / workspace (project members) / private (only you).",
  {
    id: z.string().uuid().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    kind: z.enum(["brain", "status", "decision", "ticket", "note", "doc"]).optional(),
    visibility: z.enum(["org", "workspace", "private"]).optional(),
    workspace_id: z.string().uuid().nullable().optional(),
  },
  async (args) => {
    if (args.id) {
      const patch: Record<string, unknown> = {};
      for (const k of ["title", "body", "kind", "visibility", "workspace_id"] as const) {
        if (args[k] !== undefined) patch[k] = args[k];
      }
      if (Object.keys(patch).length === 0) return fail("nothing to update");
      const { data, error } = await sb.from("kb_items").update(patch).eq("id", args.id).select().maybeSingle();
      if (error) return fail(error.message);
      if (!data) return fail("not found or you may not edit it");
      return ok({ updated: data.id, version: data.version });
    }
    if (!args.title) return fail("title required to create a new item");
    const row = {
      title: args.title,
      body: args.body ?? "",
      kind: args.kind ?? "note",
      visibility: args.visibility ?? "org",
      workspace_id: args.workspace_id ?? null,
      owner_id: personId,
    };
    const { data, error } = await sb.from("kb_items").insert(row).select().maybeSingle();
    if (error) return fail(error.message);
    return ok({ created: data?.id });
  },
);

// version history of an item
server.tool(
  "kb_history",
  "List the saved versions of a KB item (newest first). Use kb_rollback to restore one.",
  { id: z.string().uuid() },
  async ({ id }) => {
    const { data, error } = await sb
      .from("kb_item_history")
      .select("version, title, edited_by, at")
      .eq("kb_item_id", id)
      .order("version", { ascending: false });
    return error ? fail(error.message) : ok(data);
  },
);

// roll an item back to a previous version (itself versioned — no data loss)
server.tool(
  "kb_rollback",
  "Restore a KB item to a previous version number. The current state is saved to history first.",
  { id: z.string().uuid(), to_version: z.number().int().min(1) },
  async ({ id, to_version }) => {
    const { error } = await sb.rpc("kb_rollback", { p_item: id, p_to_version: to_version });
    return error ? fail(error.message) : ok({ rolled_back: id, to_version });
  },
);

// recent changes across the KB, with attribution — "what changed in X, by whom, when"
server.tool(
  "kb_changes",
  "Recent activity feed: who created/edited which KB items, and when. Optionally filter by workspace slug (e.g. 'benyamin'). Answers 'what did my partner change while I was away'.",
  {
    workspace: z.string().optional().describe("workspace slug to filter (e.g. benyamin)"),
    limit: z.number().int().min(1).max(100).default(30),
  },
  async ({ workspace, limit }) => {
    let wsId: string | null = null;
    if (workspace) {
      const { data: w } = await sb.from("workspaces").select("id").eq("slug", workspace).maybeSingle();
      if (!w) return fail(`workspace '${workspace}' not found or not visible to you`);
      wsId = w.id;
    }
    const { data: edits, error: e1 } = await sb
      .from("kb_item_history")
      .select("at, version, edited_by, item:kb_items(title, workspace_id)")
      .order("at", { ascending: false })
      .limit(limit * 2);
    if (e1) return fail(e1.message);
    const { data: creates, error: e2 } = await sb
      .from("kb_items")
      .select("title, created_at, owner_id, workspace_id")
      .order("created_at", { ascending: false })
      .limit(limit * 2);
    if (e2) return fail(e2.message);

    type Row = { type: string; at: string; by: string | null; item: string; workspace_id: string | null; version?: number };
    let feed: Row[] = [
      ...(edits ?? []).map((r: any) => ({ type: "edit", at: r.at, by: r.edited_by, item: r.item?.title ?? "?", workspace_id: r.item?.workspace_id ?? null, version: r.version })),
      ...(creates ?? []).map((r: any) => ({ type: "create", at: r.created_at, by: r.owner_id, item: r.title, workspace_id: r.workspace_id ?? null })),
    ];
    if (wsId) feed = feed.filter((x) => x.workspace_id === wsId);
    feed.sort((a, b) => (a.at < b.at ? 1 : -1));
    feed = feed.slice(0, limit);

    // resolve editor/owner ids -> names (SECURITY DEFINER rpc, bypasses strict people RLS)
    const ids = [...new Set(feed.map((f) => f.by).filter(Boolean))] as string[];
    const nameById: Record<string, string> = {};
    if (ids.length) {
      const { data: names } = await sb.rpc("people_names", { p_ids: ids });
      for (const n of names ?? []) nameById[n.id] = n.name ?? "?";
    }
    const out = feed.map((f) => ({ when: f.at, who: f.by ? nameById[f.by] ?? "מערכת/הזנה" : "מערכת/הזנה", action: f.type, item: f.item, ...(f.version ? { version: f.version } : {}) }));
    return ok(out);
  },
);

// list workspaces (projects) you belong to / may see
server.tool(
  "workspaces_list",
  "List the workspaces (projects) you can access.",
  {},
  async () => {
    const { data, error } = await sb
      .from("workspaces")
      .select("id, name, slug, description")
      .order("name");
    return error ? fail(error.message) : ok(data);
  },
);

async function main() {
  await ensureAuth();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[autotuesday-kb-mcp] ready");
}
main().catch((e) => die(String(e)));
