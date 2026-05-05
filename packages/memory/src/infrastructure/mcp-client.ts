/**
 * Generic MCP client over stdio — spawns a child process, performs
 * JSON-RPC 2.0 handshake, calls tools.
 *
 * Implements MCP 2025-11-25 handshake with version negotiation.
 *
 * source: Cortex mcp_server/infrastructure/mcp_client.py
 */

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Helper: promisified sleep (mirrors asyncio.sleep used in the Python source)
function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
import { McpConnectionError } from "../shared/errors.js";

// source: mcp_client.py:16
export const CLIENT_INFO = { name: "cortex", version: "1.0.0" } as const;
// source: mcp_client.py:17
export const PROTOCOL_VERSION = "2025-11-25" as const;

// Allowlisted MCP server commands. Only these binaries may be spawned.
// Config-supplied commands are validated against this list to prevent
// command injection (CodeQL py/command-line-injection, CWE-78).
// source: mcp_client.py:61-70
const _ALLOWED_COMMANDS = new Set([
  "node",
  "npx",
  "python",
  "python3",
  "cortex",
  "mcp-server",
]);

interface McpClientConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** ms, default 10000 */
  connectTimeoutMs?: number;
  /** ms, 0 = no per-call timeout, default 120000 */
  callTimeoutMs?: number | null;
  /** ms, default 300000 */
  idleTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class MCPClient {
  private readonly _config: McpClientConfig;
  private _reqId = 0;
  private readonly _pending = new Map<number, PendingRequest>();
  private _proc: ChildProcessWithoutNullStreams | null = null;
  private readonly _tools = new Map<string, unknown>();
  private _serverInfo: Record<string, unknown> | null = null;
  private _negotiatedVersion: string | null = null;
  private _connected = false;
  private readonly _connectTimeoutMs: number;
  private readonly _callTimeoutMs: number | null;
  private readonly _idleTimeoutMs: number;
  private _lastActivity = 0;
  private _idleTimer: ReturnType<typeof setInterval> | null = null;
  private _stderrLogFd: number | null = null;

  /** Tool-call counter (mirrors Python .tool_calls attribute). */
  toolCalls = 0;

  /** Extra commands allowed beyond the default allowlist (for testing / specialised bridges). */
  _extraAllowedCommands: Set<string> = new Set();

  constructor(config: McpClientConfig) {
    this._config = config;
    this._connectTimeoutMs = config.connectTimeoutMs ?? 10000;

    // callTimeoutMs: positive int = ms, 0 or null = no per-call timeout
    // (used for long-running upstream indexing).
    // source: mcp_client.py:34-40
    if (config.callTimeoutMs === undefined) {
      this._callTimeoutMs = 120000;
    } else if (config.callTimeoutMs === 0 || config.callTimeoutMs === null) {
      this._callTimeoutMs = null;
    } else {
      this._callTimeoutMs = Math.trunc(config.callTimeoutMs);
    }

    this._idleTimeoutMs = config.idleTimeoutMs ?? 300000;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Spawn child process, perform MCP handshake, and list tools. */
  async connect(): Promise<void> {
    if (this._connected) return;
    await this._spawnProcess();
    // source: mcp_client.py:55 — sleep 1.5s before handshake
    await _sleep(1500);
    await this._performHandshake();
  }

  /** Call a tool on the remote MCP server. */
  async call(name: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!this._connected) {
      throw new McpConnectionError("Not connected — call connect() first");
    }

    this.toolCalls += 1;
    this._touchActivity();

    const result = (await this._send("tools/call", {
      name,
      arguments: args ?? {},
    })) as Record<string, unknown> | null;

    // Prefer structuredContent (MCP 2025-11-25)
    // source: mcp_client.py:178-179
    if (result && result["structuredContent"]) {
      return result["structuredContent"];
    }

    if (!result || !result["content"]) {
      return null;
    }

    for (const block of result["content"] as Array<
      Record<string, unknown>
    >) {
      if (block["type"] === "text") {
        const text = block["text"] as string;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      }
    }

    return result;
  }

  listTools(): Record<string, unknown> {
    return Object.fromEntries(this._tools);
  }

  get serverInfo(): Record<string, unknown> | null {
    return this._serverInfo;
  }

  get protocolVersion(): string | null {
    return this._negotiatedVersion;
  }

  get connected(): boolean {
    return this._connected;
  }

  get idle(): boolean {
    return Date.now() - this._lastActivity > this._idleTimeoutMs;
  }

  /** Gracefully close the connection. */
  close(): void {
    this._connected = false;

    if (this._idleTimer !== null) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }

    // Reject pending requests
    for (const [, req] of this._pending) {
      if (req.timer !== null) clearTimeout(req.timer);
      req.reject(new McpConnectionError("Client closed"));
    }
    this._pending.clear();

    if (this._proc !== null) {
      try {
        this._proc.stdin.end();
      } catch {
        // ignore
      }
      try {
        this._proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      this._proc = null;
    }

    if (this._stderrLogFd !== null) {
      try {
        fs.closeSync(this._stderrLogFd);
      } catch {
        // ignore
      }
      this._stderrLogFd = null;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

  private async _spawnProcess(): Promise<void> {
    /**
     * Spawn the child MCP server process.
     *
     * Security: command must be in _ALLOWED_COMMANDS allowlist.
     * Args are passed as a list (no shell). Environment is
     * merged from process.env + config, not constructed from user input.
     *
     * source: mcp_client.py:72-130
     */
    const rawCommand = this._config.command;
    const args = this._config.args ?? [];
    const cwd = this._config.cwd;
    const envOverrides = this._config.env ?? {};
    const mergedEnv = { ...process.env, ...envOverrides } as Record<
      string,
      string
    >;

    // Validate command against allowlist (CWE-78 mitigation).
    // source: mcp_client.py:96-103
    const allowed = new Set([..._ALLOWED_COMMANDS, ...this._extraAllowedCommands]);
    const baseCmd = rawCommand.includes("/")
      ? rawCommand.split("/").at(-1)!
      : rawCommand;
    if (!allowed.has(baseCmd)) {
      throw new McpConnectionError(
        `Command '${rawCommand}' not in allowed list: ${[...allowed].sort().join(", ")}`,
      );
    }

    // Stream-buffer cap per JSON-RPC frame. Sized for the L6 path,
    // where AP responses with 100k+ symbols + edges legitimately
    // exceed 100MB.
    // source: mcp_client.py:92

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new McpConnectionError(
            `Connect timeout after ${this._connectTimeoutMs}ms`,
            { command: rawCommand, args },
          ),
        );
        if (this._proc) {
          try {
            this._proc.kill("SIGTERM");
          } catch {
            // ignore
          }
        }
      }, this._connectTimeoutMs);

      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = spawn(rawCommand, args, {
          cwd,
          env: mergedEnv,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        }) as ChildProcessWithoutNullStreams;
      } catch (e) {
        clearTimeout(timeout);
        reject(
          new McpConnectionError(`Failed to spawn: ${String(e)}`, {
            command: rawCommand,
            args,
          }),
        );
        return;
      }

      proc.on("error", (e: Error) => {
        clearTimeout(timeout);
        reject(
          new McpConnectionError(`Failed to spawn: ${String(e)}`, {
            command: rawCommand,
            args,
          }),
        );
      });

      proc.on("spawn", () => {
        clearTimeout(timeout);
        this._proc = proc;
        this._startReadLoop();
        this._startStderrLoop();
        resolve();
      });
    });
  }

  private async _performHandshake(): Promise<void> {
    /** Initialize protocol, negotiate version, and discover tools.
     * source: mcp_client.py:132-165
     */
    const command = this._config.command;
    try {
      const initResult = (await this._send("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      })) as Record<string, unknown>;

      this._negotiatedVersion =
        (initResult["protocolVersion"] as string | null) ?? PROTOCOL_VERSION;
      this._serverInfo = (initResult["serverInfo"] as Record<string, unknown>) ?? {};

      this._notify("notifications/initialized");

      const listResult = (await this._send("tools/list", {})) as Record<
        string,
        unknown
      >;
      for (const tool of (listResult["tools"] ?? []) as Array<
        Record<string, unknown>
      >) {
        this._tools.set(tool["name"] as string, tool);
      }

      this._connected = true;
      this._touchActivity();
      this._startIdleLoop();
    } catch (e) {
      this.close();
      throw new McpConnectionError(`Handshake failed: ${String(e)}`, {
        command,
      });
    }
  }

  private _send(method: string, params: Record<string, unknown>): Promise<unknown> {
    this._reqId += 1;
    const reqId = this._reqId;

    return new Promise<unknown>((resolve, reject) => {
      // Even when the operator opted into "no per-call timeout"
      // (callTimeoutMs == null), enforce a hard ceiling so a wedged
      // upstream cannot deadlock the caller forever. 60 minutes is
      // well above any legitimate codebase indexing job.
      // source: mcp_client.py:267-276 — deadlock observed 2026-04-27
      const effectiveTimeoutMs =
        this._callTimeoutMs !== null ? this._callTimeoutMs : 3_600_000;

      const timer =
        effectiveTimeoutMs > 0
          ? setTimeout(() => {
              this._pending.delete(reqId);
              reject(
                new McpConnectionError(
                  `Timeout after ${effectiveTimeoutMs}ms: ${method}`,
                ),
              );
            }, effectiveTimeoutMs)
          : null;

      this._pending.set(reqId, { resolve, reject, timer });

      const msg =
        JSON.stringify({
          jsonrpc: "2.0",
          id: reqId,
          method,
          params,
        }) + "\n";

      try {
        this._proc!.stdin.write(msg, "utf8");
      } catch (e) {
        this._pending.delete(reqId);
        if (timer !== null) clearTimeout(timer);
        reject(new McpConnectionError(`Write failed: ${String(e)}`));
      }
    });
  }

  private _notify(method: string, params?: Record<string, unknown>): void {
    // source: mcp_client.py:278-283
    const msg: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params) msg["params"] = params;
    try {
      this._proc!.stdin.write(JSON.stringify(msg) + "\n", "utf8");
    } catch {
      // ignore — notification failure is non-fatal
    }
  }

  private _touchActivity(): void {
    this._lastActivity = Date.now();
  }

  private _startReadLoop(): void {
    // Track terminal cause so all pending futures get a real error
    // instead of hanging forever when the reader exits.
    // source: mcp_client.py:290-361
    let buffer = "";

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("Content-Length")) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          const msgId = msg["id"] as number | undefined;
          if (msgId !== undefined) {
            const req = this._pending.get(msgId);
            if (req) {
              this._pending.delete(msgId);
              if (req.timer !== null) clearTimeout(req.timer);
              if (msg["error"]) {
                const errMsg =
                  (msg["error"] as Record<string, unknown>)["message"] ??
                  "Unknown error";
                req.reject(new McpConnectionError(String(errMsg)));
              } else {
                req.resolve(msg["result"]);
              }
            }
          }
        } catch {
          // Bad payload from the upstream is recoverable —
          // log and continue rather than killing the loop.
          process.stderr.write(
            `[mcp-client] non-JSON line dropped: ${line.slice(0, 200)}\n`,
          );
        }
      }
    };

    const onClose = (): void => {
      // Reader is exiting — wake every pending caller. Without this,
      // _send blocks forever (deadlock observed on long upstream responses).
      // source: mcp_client.py:350-361
      for (const [, req] of this._pending) {
        if (req.timer !== null) clearTimeout(req.timer);
        req.reject(
          new McpConnectionError("Upstream reader terminated: EOF"),
        );
      }
      this._pending.clear();
    };

    const onError = (err: Error): void => {
      process.stderr.write(
        `[mcp-client] reader stream error: ${err.constructor.name}: ${err.message}\n`,
      );
      for (const [, req] of this._pending) {
        if (req.timer !== null) clearTimeout(req.timer);
        req.reject(
          new McpConnectionError(
            `Upstream reader terminated: ${err.constructor.name}`,
          ),
        );
      }
      this._pending.clear();
    };

    this._proc!.stdout.on("data", onData);
    this._proc!.stdout.on("close", onClose);
    this._proc!.stdout.on("error", onError);
  }

  private _startStderrLoop(): void {
    // source: mcp_client.py:363-410
    const logFd = this._openStderrLog();
    this._stderrLogFd = logFd;

    this._proc!.stderr.on("data", (chunk: Buffer) => {
      const decoded = chunk.toString("utf8");
      process.stderr.write(
        `[mcp-client] ${this._config.command}: ${decoded}`,
      );
      if (logFd !== null) {
        try {
          fs.writeSync(logFd, decoded);
        } catch {
          // ignore log failures
        }
      }
    });
  }

  private _openStderrLog(): number | null {
    /**
     * Open a per-server stderr log file under ~/.cache/cortex/mcp-logs/.
     *
     * Persists upstream MCP stderr for post-hoc investigation.
     * Returns null on any error — logging failure must not break the connection.
     *
     * source: mcp_client.py:392-411
     */
    try {
      const base = path.join(os.homedir(), ".cache", "cortex", "mcp-logs");
      fs.mkdirSync(base, { recursive: true });
      const raw = this._config.command ?? "unknown";
      const stem = raw.split("/").at(-1) ?? "unknown";
      const safe = stem.replace(/[^a-zA-Z0-9._-]/g, "_");
      const pid = process.pid;
      const logPath = path.join(base, `${safe}.${pid}.log`);
      return fs.openSync(logPath, "a");
    } catch {
      return null;
    }
  }

  private _startIdleLoop(): void {
    // source: mcp_client.py:413-425
    this._idleTimer = setInterval(() => {
      if (this.idle) {
        process.stderr.write("[mcp-client] Idle timeout — closing connection\n");
        this.close();
      }
    }, 30_000);
  }
}

export { McpConnectionError };
