/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Shared subprocess helper for the pipeline installer modules.
 *
 * Kept in its own module so pipeline-install-rust and pipeline-installer
 * don't need to cross-import for a 20-line utility.
 *
 * Layer: INFRASTRUCTURE — subprocess utility, no core imports.
 * source: Cortex mcp_server/infrastructure/pipeline_installer_common.py
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

/** Result tuple matching Python: (returncode, stderr_tail). */
export type RunResult = [number, string];

/**
 * Run cmd capturing stderr only. Returns [returncode, stderr_tail].
 *
 * Stdout is discarded. Stderr's last 4 KiB is returned for diagnostics
 * (kept short — failures are logged, not displayed). Pass env to
 * override the inherited environment.
 *
 * precondition:  cmd is a non-empty list; cmd[0] is an executable path.
 * postcondition: returns [0, ""] on success; [returncode, tail] on failure;
 *   [-1, "timeout after Ns"] on timeout; [-2, errMsg] on spawn error.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_installer_common.py:_run_quiet
 */
export function runQuiet(
  cmd: string[],
  opts: { cwd?: string; timeout?: number; env?: Record<string, string | undefined> } = {},
): RunResult {
  // source: Cortex mcp_server/infrastructure/pipeline_installer_common.py — _run_quiet default timeout=600
  const timeoutMs = (opts.timeout ?? 600) * 1_000;
  try {
    const result = spawnSync(cmd[0] ?? "", cmd.slice(1), {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: timeoutMs,
      encoding: "buffer",
    });

    if (result.error) {
      // ETIMEDOUT from spawnSync
      const msg = result.error.message ?? "";
      if (msg.includes("ETIMEDOUT") || result.signal === "SIGTERM") {
        return [-1, `timeout after ${opts.timeout ?? 600}s`]; // source: Cortex pipeline_installer_common.py — return -1, f"timeout after {timeout}s"
      }
      return [-2, msg];
    }

    const stderrBuf: Buffer | null = result.stderr as Buffer | null;
    const stderrStr = stderrBuf
      ? stderrBuf.toString("utf-8", Math.max(0, stderrBuf.length - 4096)) // source: Cortex pipeline_installer_common.py — tail = (stderr or b"")[-4096:]
      : "";
    return [result.status ?? -2, stderrStr];
  } catch (exc) {
    return [-2, String(exc)];
  }
}

/**
 * rmtree with no error escalation (best-effort cleanup).
 *
 * source: Cortex mcp_server/infrastructure/pipeline_installer_common.py:_rmtree_quiet
 */
export function rmtreeQuiet(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
