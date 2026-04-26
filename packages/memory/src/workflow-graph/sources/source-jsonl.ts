/**
 * Session-JSONL-backed loaders for the workflow graph.
 *
 * Scans every conversation transcript under CLAUDE_DIR/projects/*\/*.jsonl
 * for tool-use blocks, slash commands, MCP invocations, and discussion
 * metadata.
 *
 * Pure infrastructure — no core imports.
 *
 * source: Cortex mcp_server/infrastructure/workflow_graph_source_jsonl.py
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type DomainFromProjectDir = (projectDir: string) => string;
export type CmdHash = (cmd: string) => string;
export type FirstLine = (text: string) => string;

const CLAUDE_DIR = join(homedir(), ".claude");

// Tool name normalization: collapses tool aliases into canonical hub names.
const _TOOL_NORMALIZE: Record<string, string> = {
  Edit: "Edit",
  MultiEdit: "Edit",
  NotebookEdit: "Edit",
  Write: "Write",
  Read: "Read",
  NotebookRead: "Read",
  Grep: "Grep",
  Glob: "Glob",
  Bash: "Bash",
  Task: "Task",
  Agent: "Task",
};

const _AGENT_TOOL_NAMES = new Set(["Task", "Agent"]);

const _FILE_INPUT_TOOLS = new Set([
  "Edit",
  "Write",
  "Read",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
  "Glob",
  "Grep",
]);

// Path-like tokens inside Bash commands.
// source: Cortex workflow_graph_source_jsonl.py _BASH_PATH_RE
const _BASH_PATH_RE =
  /(?:^|[\s=])((?:\.{1,2}\/|~\/|\/)[^\s`'"]{3,})/g;

const _SLASH_RE = /^\s*\/([A-Za-z][A-Za-z0-9:_-]*)/;
const _MCP_NAME_RE = /^mcp__([A-Za-z0-9_]+)__([A-Za-z0-9_]+)$/;

const _SKIP_SKILL_PREFIXES = new Set(["help", "clear", "reset"]);

export function normalizeToolName(name: string): string {
  return _TOOL_NORMALIZE[name] ?? "";
}

// ── JSONL helpers ─────────────────────────────────────────────────────────

function readJsonlLines(filePath: string): Record<string, unknown>[] {
  try {
    const text = readFileSync(filePath, "utf8");
    const out: Record<string, unknown>[] = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t) as Record<string, unknown>);
      } catch {
        // skip malformed lines
      }
    }
    return out;
  } catch {
    return [];
  }
}

function iterToolUses(filePath: string): Record<string, unknown>[] {
  /**
   * Yield every tool_use block found in assistant messages inside a
   * session JSONL transcript. Also emits tool_use blocks at the top
   * level (some newer transcript formats).
   */
  const out: Record<string, unknown>[] = [];
  for (const rec of readJsonlLines(filePath)) {
    const type = rec["type"];
    if (type === "assistant") {
      const content = (rec["message"] as Record<string, unknown> | undefined)
        ?.["content"];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === "object" &&
            block !== null &&
            (block as Record<string, unknown>)["type"] === "tool_use"
          ) {
            out.push(block as Record<string, unknown>);
          }
        }
      }
    }
    // Some formats emit tool_use blocks at top level with a timestamp.
    if (type === "tool_use") {
      out.push(rec);
    }
  }
  return out;
}

type SessionEntry = { sessionId: string; domain: string; path: string };

function iterSessionPaths(
  domainFromProjectDir: DomainFromProjectDir,
): SessionEntry[] {
  /**
   * Yield {sessionId, domain, path} for every session transcript under
   * CLAUDE_DIR/projects/<project>/*.jsonl. Subagent transcripts are
   * collapsed into their parent session id.
   */
  const projectsDir = join(CLAUDE_DIR, "projects");
  if (!existsSync(projectsDir)) return [];
  const out: SessionEntry[] = [];
  let pdirs: string[];
  try {
    pdirs = readdirSync(projectsDir);
  } catch {
    return [];
  }
  for (const pdir of pdirs) {
    const pdirPath = join(projectsDir, pdir);
    const domain = domainFromProjectDir(pdir);
    let entries: string[];
    try {
      entries = readdirSync(pdirPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const stem = entry.slice(0, -6);
      // Collapse subagent sessions into their parent.
      const sid = stem.split("-subagent-")[0]!.split("-explore-")[0]!;
      out.push({ sessionId: sid, domain, path: join(pdirPath, entry) });
    }
  }
  return out;
}

// ── Loader functions ──────────────────────────────────────────────────────

export function loadAgentEvents(
  domainFromProjectDir: DomainFromProjectDir,
): Record<string, unknown>[] {
  /** Scan every JSONL in full for Task tool_use blocks. */
  const buckets = new Map<string, number>();
  for (const { domain, path } of iterSessionPaths(domainFromProjectDir)) {
    for (const tu of iterToolUses(path)) {
      if (!_AGENT_TOOL_NAMES.has(String(tu["name"] ?? ""))) continue;
      const sub = (tu["input"] as Record<string, unknown> | undefined)?.[
        "subagent_type"
      ];
      if (!sub) continue;
      const key = `${String(sub)}|${domain}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  return Array.from(buckets, ([k, n]) => {
    const [sub = "", dom = ""] = k.split("|");
    return { subagent_type: sub, domain: dom, count: n };
  });
}

export function loadDiscussionToolUses(
  domainFromProjectDir: DomainFromProjectDir,
): Record<string, unknown>[] {
  /** For each session, which tool kinds it used and how often. */
  const buckets = new Map<string, number>();
  for (const { sessionId: sid, domain, path } of iterSessionPaths(
    domainFromProjectDir,
  )) {
    for (const tu of iterToolUses(path)) {
      const tool = normalizeToolName(String(tu["name"] ?? ""));
      if (!tool) continue;
      const key = `${sid}|${domain}|${tool}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  return Array.from(buckets, ([k, n]) => {
    const [s = "", d = "", t = ""] = k.split("|");
    return { session_id: s, domain: d, tool: t, count: n };
  });
}

export function loadDiscussionAgents(
  domainFromProjectDir: DomainFromProjectDir,
): Record<string, unknown>[] {
  /** Per-session Task spawn events. */
  const buckets = new Map<string, number>();
  for (const { sessionId: sid, domain, path } of iterSessionPaths(
    domainFromProjectDir,
  )) {
    for (const tu of iterToolUses(path)) {
      if (!_AGENT_TOOL_NAMES.has(String(tu["name"] ?? ""))) continue;
      const sub = (tu["input"] as Record<string, unknown> | undefined)?.[
        "subagent_type"
      ];
      if (!sub) continue;
      const key = `${sid}|${domain}|${String(sub)}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  return Array.from(buckets, ([k, n]) => {
    const [s = "", d = "", a = ""] = k.split("|");
    return { session_id: s, domain: d, subagent_type: a, count: n };
  });
}

export function loadDiscussionCommands(
  domainFromProjectDir: DomainFromProjectDir,
  cmdHashFn: CmdHash,
  firstLineFn: FirstLine,
): Record<string, unknown>[] {
  /** Per-session Bash commands: session → (cmd, cmd_hash, count). */
  const buckets = new Map<string, number>();
  for (const { sessionId: sid, path } of iterSessionPaths(
    domainFromProjectDir,
  )) {
    for (const tu of iterToolUses(path)) {
      if (tu["name"] !== "Bash") continue;
      let cmd = String(
        (tu["input"] as Record<string, unknown> | undefined)?.["command"] ?? "",
      );
      cmd = firstLineFn(cmd);
      if (!cmd) continue;
      const h = cmdHashFn(cmd);
      const key = `${sid}|${h}|${cmd}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  return Array.from(buckets, ([k, n]) => {
    const idx1 = k.indexOf("|");
    const idx2 = k.indexOf("|", idx1 + 1);
    const s = k.slice(0, idx1);
    const h = k.slice(idx1 + 1, idx2);
    const c = k.slice(idx2 + 1);
    return { session_id: s, cmd_hash: h, cmd: c, count: n };
  });
}

function collectToolFileTouches(
  tu: Record<string, unknown>,
  sid: string,
  buckets: Map<string, number>,
): void {
  const name = String(tu["name"] ?? "");
  const inp = (tu["input"] as Record<string, unknown> | undefined) ?? {};
  if (_FILE_INPUT_TOOLS.has(name)) {
    for (const key of ["file_path", "path", "notebook_path"]) {
      const fp = inp[key];
      if (fp) {
        const k = `${sid}|${String(fp)}`;
        buckets.set(k, (buckets.get(k) ?? 0) + 1);
      }
    }
  }
  if (name === "Bash") {
    const cmd = String(inp["command"] ?? "");
    _BASH_PATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = _BASH_PATH_RE.exec(` ${cmd}`)) !== null) {
      const tok = m[1]!.replace(/[.,;:)'"]+$/, "");
      if (tok.startsWith("/") || tok.startsWith("~/") || tok.startsWith("./") || tok.startsWith("../")) {
        const k = `${sid}|${tok}`;
        buckets.set(k, (buckets.get(k) ?? 0) + 1);
      }
    }
  }
}

export function loadDiscussionFiles(
  domainFromProjectDir: DomainFromProjectDir,
): Record<string, unknown>[] {
  /** For each session, return (session_id, file_path, count). */
  const buckets = new Map<string, number>();
  for (const { sessionId: sid, path } of iterSessionPaths(
    domainFromProjectDir,
  )) {
    for (const tu of iterToolUses(path)) {
      collectToolFileTouches(tu, sid, buckets);
    }
  }
  return Array.from(buckets, ([k, n]) => {
    const idx = k.indexOf("|");
    return { session_id: k.slice(0, idx), file_path: k.slice(idx + 1), count: n };
  });
}

function toolFileRefs(
  tu: Record<string, unknown>,
): Array<[path: string, ts: string | null]> {
  const name = String(tu["name"] ?? "");
  const inp = (tu["input"] as Record<string, unknown> | undefined) ?? {};
  const ts =
    (tu["timestamp"] as string | undefined) ??
    (tu["ts"] as string | undefined) ??
    null;
  const out: Array<[string, string | null]> = [];
  if (_FILE_INPUT_TOOLS.has(name)) {
    for (const key of ["file_path", "path", "notebook_path"]) {
      const fp = inp[key];
      if (fp) out.push([String(fp), ts]);
    }
  }
  if (name === "Bash") {
    const cmd = String(inp["command"] ?? "");
    _BASH_PATH_RE.lastIndex = 0;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = _BASH_PATH_RE.exec(` ${cmd}`)) !== null) {
      const tok = m[1]!.replace(/[.,;:)'"]+$/, "");
      if (
        !seen.has(tok) &&
        (tok.startsWith("/") || tok.startsWith("~/") || tok.startsWith("./") || tok.startsWith("../"))
      ) {
        seen.add(tok);
        out.push([tok, ts]);
      }
    }
  }
  return out;
}

export function loadFileAccessEvents(
  domainFromProjectDir: DomainFromProjectDir,
): Record<string, unknown>[] {
  /**
   * Synthesize tool_events from session JSONL — one row per
   * (tool, file_path, domain) with a count so the builder creates a
   * file node for every path Claude touched.
   *
   * source: Cortex workflow_graph_source_jsonl.py load_file_access_events
   */
  type Slot = [count: number, first: string | null, last: string | null];
  const buckets = new Map<string, Slot>();
  for (const { domain, path } of iterSessionPaths(domainFromProjectDir)) {
    for (const tu of iterToolUses(path)) {
      const tool = normalizeToolName(String(tu["name"] ?? ""));
      if (!tool) continue;
      for (const [fp, ts] of toolFileRefs(tu)) {
        const key = `${tool}|${fp}|${domain}`;
        const slot = buckets.get(key);
        if (slot === undefined) {
          buckets.set(key, [1, ts, ts]);
        } else {
          slot[0]++;
          if (ts && (slot[1] === null || ts < slot[1])) slot[1] = ts;
          if (ts && (slot[2] === null || ts > slot[2])) slot[2] = ts;
        }
      }
    }
  }
  return Array.from(buckets, ([k, [n, first, last]]) => {
    const [t = "", fp = "", d = ""] = k.split("|");
    return { tool: t, file_path: fp, domain: d, count: n, first_ts: first, last_ts: last };
  });
}

export function loadSkillUsage(
  domainFromProjectDir: DomainFromProjectDir,
): Record<string, unknown>[] {
  /** Record the user's slash commands per domain. */
  const buckets = new Map<string, number>();
  for (const { domain, path } of iterSessionPaths(domainFromProjectDir)) {
    for (const rec of readJsonlLines(path)) {
      if (rec["type"] !== "user") continue;
      const content = (rec["message"] as Record<string, unknown> | undefined)?.[
        "content"
      ];
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (
            typeof b === "object" &&
            b !== null &&
            (b as Record<string, unknown>)["type"] === "text"
          ) {
            text = String((b as Record<string, unknown>)["text"] ?? "");
            break;
          }
        }
      }
      const m = _SLASH_RE.exec(text);
      if (!m) continue;
      const skill = m[1]!.split(":").at(-1)!;
      if (_SKIP_SKILL_PREFIXES.has(skill)) continue;
      const key = `${skill}|${domain}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  return Array.from(buckets, ([k, n]) => {
    const idx = k.indexOf("|");
    return { name: k.slice(0, idx), domain: k.slice(idx + 1), count: n };
  });
}

export function loadMcpUsage(
  domainFromProjectDir: DomainFromProjectDir,
): Record<string, unknown>[] {
  /** Return (server, tool, domain, count) from assistant tool_uses. */
  const buckets = new Map<string, number>();
  for (const { domain, path } of iterSessionPaths(domainFromProjectDir)) {
    for (const rec of readJsonlLines(path)) {
      if (rec["type"] !== "assistant") continue;
      const content = (rec["message"] as Record<string, unknown> | undefined)?.[
        "content"
      ];
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as Record<string, unknown>;
        if (b["type"] !== "tool_use") continue;
        const m = _MCP_NAME_RE.exec(String(b["name"] ?? ""));
        if (!m) continue;
        const server = m[1]!;
        const tool = m[2]!;
        const key = `${server}|${tool}|${domain}`;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }
  }
  return Array.from(buckets, ([k, n]) => {
    const [s = "", t = "", d = ""] = k.split("|");
    return { server: s, tool: t, domain: d, count: n };
  });
}

export function loadDiscussions(
  domainFromProjectDir: DomainFromProjectDir,
): Record<string, unknown>[] {
  /**
   * Group session JSONL by domain. Each discussion carries its own
   * timeline so the detail panel can render when the session started,
   * how long it lasted, and the last activity timestamp.
   */
  const projectsDir = join(CLAUDE_DIR, "projects");
  if (!existsSync(projectsDir)) return [];
  const out: Record<string, unknown>[] = [];
  let pdirs: string[];
  try {
    pdirs = readdirSync(projectsDir);
  } catch {
    return [];
  }
  for (const pdir of pdirs) {
    const pdirPath = join(projectsDir, pdir);
    const domain = domainFromProjectDir(pdir);
    let entries: string[];
    try {
      entries = readdirSync(pdirPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const stem = entry.slice(0, -6);
      const sid = stem.split("-subagent-")[0]!.split("-explore-")[0]!;
      // Read first and last few lines to get timestamps + message count.
      const lines = readJsonlLines(join(pdirPath, entry));
      const msgCount = lines.length;
      const firstRec = lines[0] as Record<string, unknown> | undefined;
      const lastRec = lines[lines.length - 1] as Record<string, unknown> | undefined;
      // Extract title from first user message.
      let title: string | null = null;
      for (const rec of lines.slice(0, 5)) {
        if (rec["type"] === "user") {
          const content = (
            rec["message"] as Record<string, unknown> | undefined
          )?.["content"];
          if (typeof content === "string" && content.trim()) {
            title = content.trim().slice(0, 60);
            break;
          }
          if (Array.isArray(content)) {
            for (const b of content) {
              if (
                typeof b === "object" &&
                b !== null &&
                (b as Record<string, unknown>)["type"] === "text"
              ) {
                const t = String((b as Record<string, unknown>)["text"] ?? "").trim();
                if (t) { title = t.slice(0, 60); break; }
              }
            }
            if (title) break;
          }
        }
      }
      out.push({
        session_id: sid,
        domain,
        title,
        message_count: msgCount,
        started_at: (firstRec?.["timestamp"] as string | undefined) ?? null,
        last_activity: (lastRec?.["timestamp"] as string | undefined) ?? null,
        duration_ms: null,
      });
    }
  }
  return out;
}

// Skills + hooks are filesystem-scanned; JSONL doesn't carry them.
// These two functions delegate to the filesystem scanner.

export function loadSkills(): Record<string, unknown>[] {
  /**
   * Scan CLAUDE_DIR/skills/*.md for slash command skill files.
   * Returns {name, path, domains:[]} per skill found.
   * source: Cortex workflow_graph_source.py load_skills
   */
  const skillsDir = join(CLAUDE_DIR, "skills");
  if (!existsSync(skillsDir)) return [];
  const out: Record<string, unknown>[] = [];
  try {
    for (const f of readdirSync(skillsDir)) {
      if (!f.endsWith(".md")) continue;
      const name = f.slice(0, -3);
      out.push({ name, path: join(skillsDir, f), domains: [] });
    }
  } catch {
    // ignore FS errors
  }
  return out;
}

export function loadHooks(): Record<string, unknown>[] {
  /**
   * Parse CLAUDE_DIR/settings.json for hook definitions.
   * Returns {event, matcher, command, domain:null} per hook.
   * source: Cortex workflow_graph_source.py load_hooks
   */
  const settingsPath = join(CLAUDE_DIR, "settings.json");
  if (!existsSync(settingsPath)) return [];
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return [];
  }
  const hooksBlock = data["hooks"];
  if (typeof hooksBlock !== "object" || hooksBlock === null) return [];
  const out: Record<string, unknown>[] = [];
  for (const [event, entries] of Object.entries(
    hooksBlock as Record<string, unknown>,
  )) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as Record<string, unknown>[]) {
      const matcher = String(entry["matcher"] ?? "");
      const hooks = entry["hooks"];
      if (!Array.isArray(hooks)) continue;
      for (const h of hooks as Record<string, unknown>[]) {
        const cmd = h["command"];
        if (!cmd) continue;
        out.push({ event, matcher, command: String(cmd), domain: null });
      }
    }
  }
  return out;
}
