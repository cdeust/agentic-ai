/**
 * @agentic/codebase — internal/process-supervisor.ts
 *
 * Owns the lifetime of the Rust subprocess: spawn, healthcheck, dispose.
 *
 * ADR-0001 compliance: spawns with { detached: true } to create a new PGID
 * on POSIX. dispose() sends SIGTERM to the entire process group, then SIGKILL
 * after the grace timeout if the process has not exited.
 *
 * source: docs/ADR/0001-lsp-resolve-subprocess-chain.md — three-process pipeline
 * source: docs/PHASE_3_PLAN.md §3.6 — subprocess lifecycle pseudocode
 *
 * Layer: infrastructure / internal
 * Allowed imports: node:child_process, node:events, stdlib, @agentic/core errors
 */

import {
  spawn,
  type ChildProcess,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { CodebaseSubprocessError, CodebaseTimeoutError } from "@agentic/core";

/** Timeout to wait after SIGTERM before sending SIGKILL. */
const SIGKILL_GRACE_MS = 5_000; // source: docs/PHASE_3_PLAN.md §3.6 — "SIGKILL after 5_000 ms"

/** Maximum time for the initialize handshake to complete after spawn. */
const SPAWN_HEALTHCHECK_TIMEOUT_MS = 10_000; // source: docs/PHASE_3_PLAN.md §4.2 — adapter instantiation timeout

/**
 * ProcessSupervisor manages the lifecycle of a single long-lived child process.
 *
 * Class invariant:
 *   - Between spawn() and dispose(), the child process is alive and reading stdin.
 *   - send() is only safe to call from within a SerialQueue task (exactly one
 *     in-flight write at any time per ADR-0002).
 *   - After dispose() resolves, no further send() calls are made; violations
 *     throw CodebaseSubprocessError("disposed").
 */
export class ProcessSupervisor extends EventEmitter {
  private _child: ChildProcess | null = null;
  private _pgid: number | null = null;
  private _disposed = false;
  private _stdoutBuffer = "";

  constructor(
    private readonly _binaryPath: string,
    private readonly _args: readonly string[] = [],
  ) {
    super();
  }

  /**
   * Spawn the binary and wait until the subprocess is ready to accept requests.
   *
   * precondition: spawn() has not been called yet
   * postcondition: _child is alive; _pgid is set; the process emits 'line'
   *   events for each stdout line
   *
   * @throws CodebaseSubprocessError if the binary cannot be started
   * @throws CodebaseTimeoutError if no stdout line arrives within
   *   SPAWN_HEALTHCHECK_TIMEOUT_MS
   */
  async spawn(): Promise<void> {
    if (this._child !== null) {
      throw new CodebaseSubprocessError("ProcessSupervisor already spawned");
    }

    const opts: SpawnOptionsWithoutStdio = {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true, // source: docs/ADR/0001-lsp-resolve-subprocess-chain.md — new PGID on POSIX via setsid
      env: process.env,
    };

    const child = spawn(this._binaryPath, this._args as string[], opts);
    this._child = child;

    // Capture the PGID immediately; on POSIX this equals child.pid after detach.
    // source: ADR-0001 §"PGID / setsid" — dispose() kills -pgid
    this._pgid = child.pid ?? null;

    // Wire up stdout line buffering.
    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      this._stdoutBuffer += chunk;
      const lines = this._stdoutBuffer.split("\n");
      // Keep the last (potentially incomplete) fragment in the buffer.
      // invariant: lines.length >= 1; the last element is the incomplete fragment
      this._stdoutBuffer = lines[lines.length - 1] ?? "";
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (line !== undefined && line.trim().length > 0) {
          this.emit("line", line);
        }
      }
    });

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) => {
      this.emit("stderr", chunk);
    });

    child.on("error", (err: Error) => {
      this.emit("error", new CodebaseSubprocessError(err.message));
    });

    child.on("exit", (code: number | null, signal: string | null) => {
      this.emit("exit", code, signal);
    });

    // Send the MCP initialize handshake and wait for the response.
    // The binary does not emit any spontaneous output; it only responds to requests.
    // source: docs/PHASE_3_PLAN.md §1.6 — Methods handled: initialize
    await this._initialize(SPAWN_HEALTHCHECK_TIMEOUT_MS);
  }

  /**
   * Write a single NDJSON line to the child's stdin.
   *
   * precondition: spawn() has resolved; dispose() has not been called
   * postcondition: the line (terminated with \n) is in the kernel write buffer
   *
   * @throws CodebaseSubprocessError if disposed or stdin unavailable
   */
  send(line: string): void {
    if (this._disposed) {
      throw new CodebaseSubprocessError(
        "ProcessSupervisor.send() called after dispose()",
      );
    }
    const stdin = this._child?.stdin;
    if (stdin === null || stdin === undefined) {
      throw new CodebaseSubprocessError("Child stdin is not available");
    }
    stdin.write(line + "\n");
  }

  /**
   * Terminate the child process group.
   *
   * postcondition: after resolve, no process with this PGID remains running;
   *   further send() calls throw CodebaseSubprocessError("disposed")
   *
   * source: docs/ADR/0001-lsp-resolve-subprocess-chain.md — SIGTERM then SIGKILL
   */
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;

    const child = this._child;
    if (child === null) return;

    const pgid = this._pgid;

    // Close stdin so the Rust binary's read loop terminates cleanly.
    child.stdin?.end();

    // Attempt graceful SIGTERM on the process group (covers LSP grandchild).
    if (pgid !== null) {
      try {
        process.kill(-pgid, "SIGTERM");
      } catch {
        // Process may have already exited; not an error.
      }
    } else {
      child.kill("SIGTERM");
    }

    // Wait for exit; escalate to SIGKILL after grace timeout.
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        if (pgid !== null) {
          try {
            process.kill(-pgid, "SIGKILL");
          } catch {
            // Already gone.
          }
        } else {
          child.kill("SIGKILL");
        }
      }, SIGKILL_GRACE_MS);

      child.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });

      // If the child is already dead (exit event already fired), resolve now.
      if (child.exitCode !== null || child.signalCode !== null) {
        clearTimeout(killTimer);
        resolve();
      }
    });
  }

  /** Whether dispose() has been called. */
  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Send the MCP initialize handshake and wait for the response.
   *
   * The Rust binary does not emit spontaneous output; it only responds to
   * incoming JSON-RPC requests. We use the initialize request as a liveness
   * probe: if the process is up, it will respond; if not, we time out.
   *
   * source: docs/PHASE_3_PLAN.md §1.6 — Methods handled: initialize
   * source: packages/parity-runner/src/runners/codebase.ts — reference pattern
   *
   * precondition: child has been spawned and stdout listener is attached
   * postcondition: returns when the initialize response arrives; throws on timeout
   */
  private _initialize(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off("line", onLine);
        reject(
          new CodebaseTimeoutError(
            "ProcessSupervisor.spawn",
            timeoutMs,
          ),
        );
      }, timeoutMs);

      const onLine = (_line: string): void => {
        clearTimeout(timer);
        this.off("line", onLine);
        resolve();
      };

      this.once("line", onLine);

      // Send the initialize request immediately.
      const initRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05", // source: docs/PHASE_3_PLAN.md §1.5 — MCP protocol version used by binary
          capabilities: {},
          clientInfo: { name: "@agentic/codebase", version: "0.1.0" },
        },
      });

      const stdin = this._child?.stdin;
      if (stdin === null || stdin === undefined) {
        clearTimeout(timer);
        this.off("line", onLine);
        reject(new CodebaseSubprocessError("Child stdin not available during initialize"));
        return;
      }
      stdin.write(initRequest + "\n");
    });
  }
}
