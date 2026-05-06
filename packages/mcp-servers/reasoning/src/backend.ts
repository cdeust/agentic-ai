/**
 * backend.ts — Infrastructure adapter: delegates tool calls to memory-tool.sh.
 *
 * Precondition:  args is a non-empty string array; first element is a valid
 *                memory-tool.sh subcommand.
 * Postcondition: returns [stdout_text, isError] where isError reflects the
 *                backend exit code per the spec:
 *                  exit 0 → isError=false
 *                  exit 1 → isError=true (contract error, stdout has message)
 *                  exit 2+ → isError=true (fatal, stderr has message)
 *
 * source: zetetic@HEAD tools/memory-mcp-server.py:223-255 (run_backend)
 *
 * Layer: infrastructure — this file may not be imported by core or handlers
 *        except through the BackendRunner interface.
 *
 * Logging: ONLY to stderr. Never to stdout (corrupts JSON-RPC framing).
 * source: modelcontextprotocol.io/quickstart/server §"Logging in MCP Servers"
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Constants ─────────────────────────────────────────────────────────────────

// source: zetetic@HEAD tools/memory-mcp-server.py:38-39 (_SCRIPT_DIR, BACKEND_CMD)
const _SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// DEFAULT_BACKEND_CMD is computed once at module load from the dist/ location.
// MEMORY_BACKEND_CMD env override is read lazily at each call to runBackend,
// so test fixtures that set process.env after import take effect correctly.
// source: zetetic@HEAD tools/memory-mcp-server.py:39
// Path from dist/ to memory-tool.sh in the sibling zetetic-team-subagents repo.
// Computed via: os.path.relpath(
//   '/Users/cdeust/Developments/zetetic-team-subagents/tools/memory-tool.sh',
//   '/Users/cdeust/Developments/agentic-ai/worktrees/port-fix/
//    zetetic-mcp-server-port-2026-05-06/packages/mcp-servers/reasoning/dist'
// ) == '../../../../../../../../zetetic-team-subagents/tools/memory-tool.sh'
//
// source: zetetic@HEAD tools/memory-mcp-server.py:38-39 (_SCRIPT_DIR, BACKEND_CMD)
// source: measured on 2026-05-06 in worktree
//   dist/ is 8 levels above Developments/; memory-tool.sh is in
//   Developments/zetetic-team-subagents/tools/
const DEFAULT_BACKEND_CMD: string =
  `${_SCRIPT_DIR}/../../../../../../../../zetetic-team-subagents/tools/memory-tool.sh`;

/**
 * Return the effective backend command.
 *
 * Python source never reads MEMORY_BACKEND_CMD — it uses the filesystem path
 * computed at module load from _SCRIPT_DIR (memory-mcp-server.py:39).
 * The TS port adds MEMORY_BACKEND_CMD as a test-isolation escape hatch, but
 * only when the value is a non-empty string.  An empty string is treated as
 * "not set" so that callers who set MEMORY_BACKEND_CMD="" do not accidentally
 * pass "" to bash (which fails with "bash: : No such file or directory").
 *
 * source: zetetic@HEAD tools/memory-mcp-server.py:38-39 (_SCRIPT_DIR, BACKEND_CMD)
 * fix: empty-string guard — mirrors Python's absence of this env-var entirely.
 */
function resolveBackendCmd(): string {
  const override = process.env["MEMORY_BACKEND_CMD"];
  // Only honour the override if it is a non-empty string.
  return (override !== undefined && override !== "") ? override : DEFAULT_BACKEND_CMD;
}

// ── Environment inheritance ───────────────────────────────────────────────────

/**
 * Build subprocess env: inherit everything, ensure MEMORY_AGENT_ID is set.
 *
 * Postcondition: returned env has MEMORY_AGENT_ID key.
 * source: zetetic@HEAD tools/memory-mcp-server.py:213-220 (_inherit_env)
 */
function inheritEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // MEMORY_AGENT_ID is mandatory for audit attribution; fall back to 'unknown'
  // only if not set at all.
  // source: zetetic@HEAD tools/memory-mcp-server.py:218-219
  if (!env["MEMORY_AGENT_ID"]) {
    env["MEMORY_AGENT_ID"] = "unknown";
  }
  return env;
}

// ── Backend runner ────────────────────────────────────────────────────────────

/**
 * Run memory-tool.sh with the given arg list.
 *
 * Precondition:  args.length >= 1; args[0] is a valid subcommand.
 * Postcondition: returns [text, isError] where text is the tool output and
 *                isError=true when the backend signals a failure.
 *
 * Exit-code semantics (source: zetetic@HEAD tools/memory-mcp-server.py:226-255):
 *   0  → success; stdout is tool_result content.
 *   1  → contract error; stdout carries the verbatim spec error string.
 *   2+ → fatal internal error; stderr has the message.
 */
export function runBackend(args: string[]): [string, boolean] {
  // precondition: args is non-empty
  try {
    const stdout = execFileSync("bash", [resolveBackendCmd(), ...args], {
      encoding: "utf-8",
      env: inheritEnv(),
      // execFileSync throws on non-zero exit; we catch below.
    });
    // postcondition: exit 0 → isError=false
    return [stdout, false];
  } catch (err: unknown) {
    // execFileSync throws a SpawnSyncError on non-zero exit or OS-level failure.
    const spawnErr = err as {
      status?: number | null;
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    const exitCode = spawnErr.status ?? -1;
    const stdout = spawnErr.stdout ?? "";
    const stderr = (spawnErr.stderr ?? "").trim();

    if (exitCode === 1) {
      // Contract error — stdout carries the verbatim spec error string.
      // source: zetetic@HEAD tools/memory-mcp-server.py:249-251
      return [stdout !== "" ? stdout : stderr, true];
    }

    if (exitCode === -1 || exitCode == null) {
      // OS-level failure (ENOENT, permission denied, etc.).
      // source: zetetic@HEAD tools/memory-mcp-server.py:238-239
      const msg = spawnErr.message ?? "could not execute backend";
      return [`Fatal: could not execute backend: ${msg}`, true];
    }

    // Fatal (exit 2+).
    // source: zetetic@HEAD tools/memory-mcp-server.py:253-255
    const msg = stderr !== "" ? stderr : stdout;
    return [msg !== "" ? msg : `Backend exited with code ${exitCode}`, true];
  }
}

// ── Argument mappers ──────────────────────────────────────────────────────────

/**
 * Map memory tool input → memory-tool.sh argv.
 *
 * Precondition:  params.command is one of the enum values in the memory schema.
 * Postcondition: returns string[] (argv to pass after BACKEND_CMD) or null if
 *                command is unrecognised.
 *
 * source: zetetic@HEAD tools/memory-mcp-server.py:260-295 (_map_memory)
 */
export function mapMemoryArgs(
  params: Record<string, unknown>,
): string[] | null {
  const cmd = params["command"] as string | undefined;

  if (cmd === "view") {
    const args = ["view", String(params["path"] ?? "")];
    const vr = params["view_range"];
    if (Array.isArray(vr) && vr.length === 2) {
      // source: zetetic@HEAD tools/memory-mcp-server.py:265-267
      args.push(String(vr[0]), String(vr[1]));
    }
    return args;
  }

  if (cmd === "create") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:271
    return ["create", String(params["path"] ?? ""), String(params["file_text"] ?? "")];
  }

  if (cmd === "str_replace") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:273-279
    return [
      "str_replace",
      String(params["path"] ?? ""),
      String(params["old_str"] ?? ""),
      String(params["new_str"] ?? ""),
    ];
  }

  if (cmd === "insert") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:281-286
    return [
      "insert",
      String(params["path"] ?? ""),
      String(params["insert_line"] ?? 0),
      String(params["insert_text"] ?? ""),
    ];
  }

  if (cmd === "delete") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:288-289
    return ["delete", String(params["path"] ?? "")];
  }

  if (cmd === "rename") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:291-292
    return ["rename", String(params["old_path"] ?? ""), String(params["new_path"] ?? "")];
  }

  // unknown command — caller handles
  // source: zetetic@HEAD tools/memory-mcp-server.py:294-295
  return null;
}

/**
 * Map memory_extensions tool input → memory-tool.sh argv.
 *
 * Precondition:  params.command is one of the enum values in memory_extensions schema.
 * Postcondition: returns string[] or null if command is unrecognised.
 *
 * source: zetetic@HEAD tools/memory-mcp-server.py:298-345 (_map_extensions)
 */
export function mapExtensionsArgs(
  params: Record<string, unknown>,
): string[] | null {
  const cmd = params["command"] as string | undefined;

  if (cmd === "search") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:303-309
    const args = ["search", String(params["query"] ?? "")];
    if (params["scope"]) {
      args.push("--scope", String(params["scope"]));
    }
    if (params["limit"]) {
      args.push("--limit", String(params["limit"]));
    }
    if (params["regex"]) {
      args.push("--regex");
    }
    return args;
  }

  if (cmd === "scopes") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:312-313
    return ["scopes"];
  }

  if (cmd === "preamble") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:315-316
    return ["preamble"];
  }

  if (cmd === "sync-status") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:318-319
    return ["sync-status"];
  }

  if (cmd === "drain-sync") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:321-324
    const args = ["drain-sync"];
    if (params["limit"]) {
      args.push("--limit", String(params["limit"]));
    }
    return args;
  }

  if (cmd === "commit-sync") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:326-327
    return ["commit-sync", String(params["job_id"] ?? "")];
  }

  if (cmd === "release-sync") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:329-330
    return ["release-sync", String(params["job_id"] ?? "")];
  }

  if (cmd === "ttl-sweep") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:332-335
    const args = ["ttl-sweep"];
    if (params["dry_run"]) {
      args.push("--dry-run");
    }
    return args;
  }

  if (cmd === "audit") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:337-340
    const args = ["audit"];
    if (params["since"]) {
      args.push("--since", String(params["since"]));
    }
    return args;
  }

  // unknown command
  // source: zetetic@HEAD tools/memory-mcp-server.py:342-345
  return null;
}
